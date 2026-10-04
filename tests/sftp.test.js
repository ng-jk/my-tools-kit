'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const engine = require('../build/sftp/engine');
function fixture(t, extra={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-sftp-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const local=path.join(dir,'local'),remote=path.join(dir,'remote');
  fs.mkdirSync(local);fs.mkdirSync(remote);
  const raw={host:'fixture',username:'fixture',protocol:'local',remotePath:remote.replaceAll('\\','/'),ignore:['ignored.txt'],...extra};
  const session=engine.createSession(local,raw);t.after(()=>session.service.dispose());
  return {dir,local,remote,raw,session};
}
test('shared engine uploads/downloads nested files, ignores patterns, compares and creates remote files',async t=>{
  const {local,remote,session}=fixture(t);
  fs.mkdirSync(path.join(local,'nested'));fs.writeFileSync(path.join(local,'nested','a.txt'),'original');fs.writeFileSync(path.join(local,'ignored.txt'),'ignore');
  const uploaded=await engine.operate(session,'upload');assert.equal(uploaded.passed,true);
  assert.equal(fs.readFileSync(path.join(remote,'nested','a.txt'),'utf8'),'original');assert.equal(fs.existsSync(path.join(remote,'ignored.txt')),false);
  fs.writeFileSync(path.join(remote,'nested','a.txt'),'remote edit');await engine.operate(session,'download','nested/a.txt');
  assert.equal(fs.readFileSync(path.join(local,'nested','a.txt'),'utf8'),'remote edit');
  assert.deepEqual(await engine.operate(session,'diff','nested/a.txt'),{local:'remote edit',remote:'remote edit'});
  await engine.operate(session,'mkdir','created');await engine.operate(session,'create','created/new.txt');
  await assert.rejects(engine.operate(session,'create','created/new.txt'),/exists/);
  await engine.operate(session,'rename','created/new.txt',{to:'created/renamed.txt'});
  assert.equal(fs.existsSync(path.join(remote,'created','renamed.txt')),true);
});
test('sync awaits deletion and never treats an unreadable source as empty',async t=>{
  const {local,remote,session}=fixture(t,{syncOption:{delete:true}});
  fs.writeFileSync(path.join(local,'a.txt'),'new');fs.writeFileSync(path.join(remote,'extra.txt'),'extra');
  await assert.rejects(engine.operate(session,'sync-up'),/requires --yes/);
  await engine.operate(session,'sync-up','.',{yes:true});assert.equal(fs.existsSync(path.join(remote,'extra.txt')),false);
  const source=session.service.getLocalFileSystem();const original=source.list;
  source.list=async()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});};
  try {await assert.rejects(engine.operate(session,'sync-up','.',{yes:true}),/denied/);assert.equal(fs.existsSync(path.join(remote,'a.txt')),true);} finally {source.list=original;}
});
test('profile contexts and temp upload preserve configuration behavior',async t=>{
  const {local,remote,raw}=fixture(t);
  fs.mkdirSync(path.join(local,'nested'));fs.writeFileSync(path.join(local,'nested','a.txt'),'temp');
  const session=engine.createSession(local,{...raw,profiles:{dev:{context:'nested',useTempFile:true}},defaultProfile:'dev'});
  t.after(()=>session.service.dispose());assert.equal(session.service.baseDir,path.join(local,'nested'));
  await engine.operate(session,'upload','a.txt');assert.equal(fs.readFileSync(path.join(remote,'a.txt'),'utf8'),'temp');
  assert.equal(fs.existsSync(path.join(remote,'a.txt.new')),false);
  assert.throws(()=>engine.createSession(local,raw,'missing'),/Unknown profile/);
});
test('failed scheduled transfer rejects and path traversal cannot escape context',async t=>{
  const {local,session}=fixture(t);fs.writeFileSync(path.join(local,'a.txt'),'x');
  const target=await session.service.getRemoteFileSystem(session.config);const original=target.put;
  target.put=async()=>{throw new Error('network disconnected');};
  try {await assert.rejects(engine.operate(session,'upload','a.txt'),/network disconnected/);} finally {target.put=original;}
  await assert.rejects(engine.operate(session,'upload','../outside'),/relative/);
  await assert.rejects(engine.operate(session,'delete','.' ,{yes:true}),/non-root/);
  for (const name of ['./','./.','folder/..','']) {
    await assert.rejects(engine.operate(session,'delete',name,{yes:true}),/non-root/);
    await assert.rejects(engine.operate(session,'rename',name,{to:'new'}),/non-root/);
  }
});
test('host keys reject unknown/changed/revoked keys and support pins and hashed known_hosts',t=>{
  const {dir}=fixture(t);const crypto=require('node:crypto');
  const key=Buffer.from('public-host-key'),changed=Buffer.from('changed-key'),file=path.join(dir,'known_hosts');
  const config={host:'example.test',port:2222,knownHostsPath:file};
  assert.equal(engine.verifyHostKey(config,key),false);
  assert.equal(engine.verifyHostKey({...config,hostFingerprint:engine.fingerprint(key)},key),true);
  assert.equal(engine.verifyHostKey({...config,hostFingerprint:engine.fingerprint(key)},changed),false);
  fs.writeFileSync(file,'[example.test]:2222 ssh-ed25519 '+key.toString('base64')+'\n');
  assert.equal(engine.verifyHostKey(config,key),true);assert.equal(engine.verifyHostKey(config,changed),false);
  fs.appendFileSync(file,'@revoked [example.test]:2222 ssh-ed25519 '+key.toString('base64')+'\n');assert.equal(engine.verifyHostKey(config,key),false);
  const salt=crypto.randomBytes(20),hash=crypto.createHmac('sha1',salt).update('[example.test]:2222').digest('base64');
  fs.writeFileSync(file,'|1|'+salt.toString('base64')+'|'+hash+' ssh-ed25519 '+key.toString('base64')+'\n');
  assert.equal(engine.verifyHostKey(config,key),true);
});
test('SSH terminal puts options before the host and remote commands after it without a local shell',()=>{
  const args=engine.sshArguments({protocol:'sftp',host:'example.test',username:'deploy',port:22,remotePath:'/project',sshCustomParams:'-o ServerAliveInterval=30 "cd ${remotePath}; exec bash"'});
  assert.deepEqual(args,['-t','-p','22','-o','ServerAliveInterval=30','--','deploy@example.test','cd /project; exec bash']);
});
test('Git mirror snapshots remote content before upload and bidirectional sync copies both sides',async t=>{
  const {dir,local,remote,raw}=fixture(t);
  const mirror=path.join(dir,'mirror');
  const session=engine.createSession(local,{...raw,mirror:{enabled:true,path:mirror}});t.after(()=>session.service.dispose());
  fs.writeFileSync(path.join(local,'a.txt'),'local replacement');fs.writeFileSync(path.join(remote,'a.txt'),'remote before upload');
  await engine.operate(session,'upload','a.txt');
  assert.equal(fs.readFileSync(path.join(mirror,'a.txt'),'utf8'),'remote before upload');
  assert.ok(fs.existsSync(path.join(mirror,'.git','HEAD')));
  fs.writeFileSync(path.join(local,'only-local.txt'),'local');fs.writeFileSync(path.join(remote,'only-remote.txt'),'remote');
  await engine.operate(session,'sync-both');
  assert.equal(fs.readFileSync(path.join(remote,'only-local.txt'),'utf8'),'local');
  assert.equal(fs.readFileSync(path.join(local,'only-remote.txt'),'utf8'),'remote');
});
test('terminal uses the same engine and reports errors with nonzero exit',async t=>{
  const {local,remote,raw}=fixture(t);fs.mkdirSync(path.join(local,'.vscode'));fs.writeFileSync(path.join(local,'.vscode','sftp.json'),JSON.stringify(raw));fs.writeFileSync(path.join(local,'cli.txt'),'from CLI');
  const run=(...args)=>spawnSync(process.execPath,[path.resolve('cli.js'),'sftp',...args],{encoding:'utf8',timeout:20000});
  const uploaded=run('upload',local,'cli.txt');assert.equal(uploaded.status,0,uploaded.stderr);assert.equal(JSON.parse(uploaded.stdout).passed,true);assert.equal(fs.readFileSync(path.join(remote,'cli.txt'),'utf8'),'from CLI');
  assert.equal(run('upload',local,'missing').status,1);
  const profiles=run('profiles',local);assert.equal(profiles.status,0,profiles.stderr);assert.equal(profiles.stdout.includes('password'),false);
});
test('sidebar contributes a toolkit entry and all upstream public SFTP commands',()=>{
  const manifest=require('../package.json'),upstream=require('../vendor/sftp/package.json');
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].id,'devkit');
  assert.ok(manifest.contributes.views.devkit.some(v=>v.id==='devkit.tools'));
  for(const command of upstream.contributes.commands) assert.ok(manifest.contributes.commands.some(c=>c.command==='devkit.'+command.command),command.command);
  const metadata=JSON.parse(fs.readFileSync('dist/sftp-engine-metafile.json','utf8'));
  assert.equal(Object.keys(metadata.inputs).some(p=>p.startsWith('src/interface/')),false);
  assert.equal(Object.values(metadata.outputs).some(o=>o.imports.some(i=>i.path==='vscode')),false);
});
