#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { readJson, writeAtomic } = require('./lib/files');
const pipeline = require('./lib/pipeline');
function main(args = process.argv.slice(2)) {
  const [command, rootArg, ...rest] = args;
  if (!command || command === '--help') {
    console.log('Usage: node pipeline-cli.js inspect|plan|apply|check|rollback <project> [--agents codex,claude] [--out plan.json] [--plan plan.json]'); return;
  }
  if (!rootArg || rootArg.startsWith('--')) throw new Error('An explicit project directory is required');
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--agents', '--out', '--plan'].includes(rest[i]) || !rest[i + 1]) throw new Error('Invalid option: ' + rest[i]);
    flags[rest[i]] = rest[i + 1];
  }
  const root = path.resolve(rootArg); let result;
  if (command === 'inspect') result = pipeline.inspect(root);
  else if (command === 'plan') result = pipeline.plan(root, { agents: flags['--agents']?.split(',') || [] });
  else if (command === 'apply') { if (!flags['--plan']) throw new Error('apply requires --plan with a reviewed saved plan'); result = pipeline.apply(root, readJson(flags['--plan'])); }
  else if (command === 'check') result = pipeline.check(root);
  else if (command === 'rollback') result = pipeline.rollback(root);
  else throw new Error('Unknown command: ' + command);
  const text = JSON.stringify(result, null, 2) + '\n';
  if (flags['--out']) writeAtomic(path.resolve(flags['--out']), text); else console.log(text.trimEnd());
  if (result.passed === false || result.findings?.some(f => f.severity === 'error')) process.exitCode = 1;
  return result;
}
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { main };
