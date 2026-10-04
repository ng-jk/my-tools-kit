#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { readJson, writeAtomic } = require('../data/files');
const { execute, runCollection } = require('../logic/api');
const { importCollection, exportPostman, curl } = require('../logic/formats');
const { report, junit } = require('../logic/reports');
async function main(args = process.argv.slice(2)) {
  if (args[0] === 'sftp') return require('./sftp-cli').main(args.slice(1));
  if (['json', 'compare', 'git-compare', 'git-changes', 'git-history', 'git-files'].includes(args[0])) return require('./text-cli').main(args);
  if (args[0] === 'pipeline') return require('./pipeline-cli').main(args.slice(1));
  const [command, file, ...rest] = args;
  if (!command || command === '--help') { console.log(`devkit run <collection.json> [--env file.json] [--allow-scripts] [--json report.json] [--junit report.xml]
devkit send <request.json> [--env file.json] [--allow-scripts] [--out response.json] [--download body.bin]
devkit curl <request.json> [--out request.sh]
devkit import <input.json> --out collection.json
devkit export <collection.json> --out postman.json
devkit pipeline status|init|check|test|accept-uat|marketplace-check|publish <project> [options]
devkit sftp --help
devkit json <file|-> [--minify|--validate] [--indent 2|4|tab] [--out file]
devkit compare <left-file|-> <right-file|-> [--json] [--ignore-case] [--trim-whitespace] [--line-endings]
devkit git-history <root>
devkit git-files <root> <revision>
devkit git-changes <root> <base> <target>
devkit git-compare <root> <base> <target> <left-path> [right-path]`); return; }
  if (!file) throw new Error('Input file is required');
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--allow-scripts') { flags[rest[i]] = true; continue; }
    if (!['--env', '--json', '--junit', '--out', '--download'].includes(rest[i]) || !rest[i + 1]) throw new Error('Invalid option: ' + rest[i]);
    flags[rest[i]] = rest[++i];
  }
  if (command === 'run' || command === 'send') {
    if (command === 'send' && flags['--junit']) throw new Error('--junit is available for collection runs');
    if (command === 'run' && (flags['--out'] || flags['--download'])) throw new Error('Use --json for collection reports; --out/--download are single-request options');
    const variables = { ...(flags['--env'] ? readJson(flags['--env']) : {}) };
    for (const [key, value] of Object.entries(process.env)) variables['env.' + key] = value;
    const controller = new AbortController(); const interrupt = () => controller.abort(); process.once('SIGINT', interrupt);
    try {
      const run = await (command === 'send' ? execute : runCollection)(readJson(file), { root: path.dirname(path.resolve(file)), variables, allowScripts: !!flags['--allow-scripts'], signal: controller.signal });
      const summary = command === 'send' ? { ...run, variables: undefined, base64: undefined } : report(run);
      if (flags['--out']) writeAtomic(path.resolve(flags['--out']), JSON.stringify(summary, null, 2) + '\n');
      if (flags['--download']) writeAtomic(path.resolve(flags['--download']), Buffer.from(run.base64, 'base64'));
      if (flags['--json']) writeAtomic(path.resolve(flags['--json']), JSON.stringify(summary, null, 2) + '\n');
      if (flags['--junit']) writeAtomic(path.resolve(flags['--junit']), junit(summary));
      console.log(JSON.stringify(summary, null, 2)); if (!summary.passed) process.exitCode = 1;
    } finally { process.removeListener('SIGINT', interrupt); }
  } else if (command === 'curl') {
    const result = curl(readJson(file));
    if (flags['--out']) writeAtomic(path.resolve(flags['--out']), result + '\n'); else console.log(result);
  } else if (command === 'import' || command === 'export') {
    if (!flags['--out']) throw new Error('--out is required');
    const result = command === 'import' ? importCollection(readJson(file)) : exportPostman(readJson(file));
    writeAtomic(path.resolve(flags['--out']), JSON.stringify(result.collection || result.data, null, 2) + '\n');
    for (const warning of result.warnings) console.error(warning);
  } else throw new Error('Unknown command: ' + command);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main, report, junit };
