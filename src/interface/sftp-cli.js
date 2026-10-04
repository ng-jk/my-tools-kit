'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createSession, operate, configurePorts, sshArguments, watchPolicy, getCommitChangedFiles, getUncommittedChangedFiles, isOwnLocalChange, initialConfig } = require('../../build/sftp/engine');
function expand(value) {
  if (typeof value === 'string') return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => {
    if (process.env[key] === undefined) throw new Error('Missing environment variable: ' + key);
    return process.env[key];
  });
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
  return value;
}
async function main(args) {
  if (!args.length || args.includes('--help')) {
    console.log(`devkit sftp <action> <workspace> [relative-path] [options]
Actions: config, profiles, list, read, diff, upload, download, sync-up, sync-down,
sync-both, mkdir, create, rename, delete, upload-changed, upload-commit, watch, ssh
Options: --config FILE --profile NAME --context NAME --all-profiles --force --yes
         --to RELATIVE-PATH --commit REVISION
Reads .vscode/sftp.json. Paths are relative to the chosen profile context.
Use SSH agent/key or DEVKIT_SFTP_PASSWORD; config supports \${env:NAME}.
watch uploads changed files when watcher.autoUpload or uploadOnSave is enabled;
watcher.autoDelete requires --yes. Ctrl+C cancels transfers and disconnects.
UI-only actions (editor selection, clipboard, reveal and native diff) use explicit
paths and JSON output here. Transfer, profile and sync logic is shared.`);
    return;
  }
  const [action, workspace = '.', ...rest] = args;
  const root = path.resolve(workspace); const flags = {}; let relative = '.';
  for (let i = 0; i < rest.length; i++) {
    if (['--all-profiles','--force','--yes'].includes(rest[i])) flags[rest[i].slice(2)] = true;
    else if (['--config','--profile','--context','--to','--commit'].includes(rest[i]) && rest[i + 1]) flags[rest[i].slice(2)] = rest[++i];
    else if (!rest[i].startsWith('--') && relative === '.') relative = rest[i];
    else throw new Error('Unknown argument: ' + rest[i]);
  }
  const configPath = flags.config ? path.resolve(flags.config) : path.join(root,'.vscode','sftp.json');
  if (action === 'config') {
    fs.mkdirSync(path.dirname(configPath), {recursive:true});
    if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify(initialConfig(),null,2)+'\n', {flag:'wx'});
    console.log(JSON.stringify({passed:true,config:configPath})); return;
  }
  const value = expand(JSON.parse(fs.readFileSync(configPath,'utf8')));
  const configs = Array.isArray(value) ? value : [value];
  if (action === 'profiles') {
    console.log(JSON.stringify(configs.map(config => ({name:config.name,context:config.context || '.',profiles:Object.keys(config.profiles || {}),defaultProfile:config.defaultProfile})),null,2)); return;
  }
  const choices = flags.context ? configs.filter(c => c.name === flags.context || c.context === flags.context) : configs;
  if (choices.length !== 1) throw new Error('Choose exactly one configuration with --context NAME');
  const raw = choices[0];
  const profiles = flags['all-profiles'] ? Object.keys(raw.profiles || {}) : [flags.profile];
  if (!profiles.length) throw new Error('No profiles configured');
  configurePorts({password:async () => {
    if (process.env.DEVKIT_SFTP_PASSWORD === undefined) throw new Error('Set DEVKIT_SFTP_PASSWORD or configure SSH key/agent authentication');
    return process.env.DEVKIT_SFTP_PASSWORD;
  }});
  const results = [];
  let cancelled = false;
  for (const profile of profiles) {
    if (cancelled) break;
    const session = createSession(root,raw,profile);
    const cancel = () => { cancelled = true; session.service.cancelTransferTasks(); session.service.dispose(); process.exitCode = 130; };
    process.once('SIGINT', cancel);
    try {
      if (action === 'upload-changed' || action === 'upload-commit') {
        const files = action === 'upload-commit' ? await getCommitChangedFiles(root, flags.commit || 'HEAD') : await getUncommittedChangedFiles(root);
        const transfers = [];
        for (const file of new Set(files)) {
          if (cancelled) break;
          const local = path.relative(session.service.baseDir,path.resolve(root,file));
          if (local === '..' || local.startsWith('..'+path.sep) || path.isAbsolute(local)) continue;
          transfers.push(await operate(session,'upload',local,flags));
        }
        results.push({profile:session.profile,files:transfers.length});
      } else if (action === 'watch') {
        if (profiles.length !== 1) throw new Error('Watch requires one profile');
        const watcherConfig = watchPolicy(session.config, flags.yes);
        const { minimatch } = require('../../build/sftp/watch-match');
        await new Promise((resolve,reject) => {
          let queue = Promise.resolve();
          let stopped = false;
          const watcher = fs.watch(session.service.baseDir,{recursive:true},(_,name) => {
            if (!name || stopped || cancelled) return;
            const matches = watcherConfig.files !== false && (!watcherConfig.files || minimatch(name.replaceAll('\\','/'),watcherConfig.files,{dot:true}));
            const full = path.join(session.service.baseDir,name);
            if (session.config.ignore?.(full) || isOwnLocalChange(full)) return;
            queue = queue.then(async () => {
              if (stopped || cancelled || isOwnLocalChange(full)) return;
              if (fs.existsSync(full)) {
                if (watcherConfig.uploadOnSave || (matches && watcherConfig.autoUpload)) await operate(session,'upload',name,flags);
              } else if (matches && watcherConfig.autoDelete) await operate(session,'delete',name,flags);
            }).catch(error => { finish(error); });
          });
          const stop = () => { stopped = true; watcher.close(); queue.then(() => finish(), finish); };
          const finish = error => { stopped = true; watcher.close(); process.removeListener('SIGINT',stop); error ? reject(error) : resolve(); };
          watcher.once('error',finish);
          process.once('SIGINT',stop);
          console.error('Watching ' + session.service.baseDir + '; Ctrl+C to stop');
        });
      } else if (action === 'ssh') {
        const argv = sshArguments(session.config);
        await new Promise((resolve,reject) => { const child=spawn('ssh',argv,{stdio:'inherit',shell:false}); child.once('error',reject); child.once('exit',code => code===0?resolve():reject(new Error('ssh exited '+code))); });
      } else results.push({profile:session.profile,result:await operate(session,action,relative,flags)});
    } finally { process.removeListener('SIGINT',cancel); session.service.dispose(); }
  }
  console.log(JSON.stringify({passed:process.exitCode!==130,results},null,2));
}
module.exports = {main};
