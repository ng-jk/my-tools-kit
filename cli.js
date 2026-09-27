#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { readJson, writeAtomic } = require('./lib/files');
const { runCollection } = require('./lib/api');
const { importCollection, exportPostman } = require('./lib/formats');
const escapeXml = text => String(text).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function report(run) {
  // Reports exclude bodies, headers, resolved URLs, variables, script logs and raw errors.
  return { passed: run.passed, results: run.results.map((r, index) => ({ index, status: r.status, time: r.time, passed: r.passed, ...(r.error ? { error: 'Request execution failed' } : {}), tests: r.tests.map((t, i) => ({ index: i, passed: t.passed })) })) };
}
function junit(summary) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="API collection" tests="${summary.results.length}" failures="${summary.results.filter(r => !r.passed).length}">` + summary.results.map(r => `<testcase name="Request ${r.index + 1}" time="${(r.time || 0) / 1000}">${r.passed ? '' : '<failure message="' + escapeXml(r.error || 'HTTP or assertion failure') + '"/>'}</testcase>`).join('') + '</testsuite>\n';
}
async function main(args = process.argv.slice(2)) {
  if (args[0] === 'pipeline') return require('./pipeline-cli').main(args.slice(1));
  const [command, file, ...rest] = args;
  if (!command || command === '--help') { console.log('devkit run <collection.json> [--env file.json] [--allow-scripts] [--json report.json] [--junit report.xml]\ndevkit import <input.json> --out collection.json\ndevkit export <collection.json> --out postman.json\ndevkit pipeline inspect|plan|apply|check|rollback <project>'); return; }
  if (!file) throw new Error('Input file is required');
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--allow-scripts') { flags[rest[i]] = true; continue; }
    if (!['--env', '--json', '--junit', '--out'].includes(rest[i]) || !rest[i + 1]) throw new Error('Invalid option: ' + rest[i]);
    flags[rest[i]] = rest[++i];
  }
  if (command === 'run') {
    const variables = { ...(flags['--env'] ? readJson(flags['--env']) : {}) };
    for (const [key, value] of Object.entries(process.env)) variables['env.' + key] = value;
    const controller = new AbortController(); const interrupt = () => controller.abort(); process.once('SIGINT', interrupt);
    try {
      const run = await runCollection(readJson(file), { root: path.dirname(path.resolve(file)), variables, allowScripts: !!flags['--allow-scripts'], signal: controller.signal });
      const summary = report(run);
      if (flags['--json']) writeAtomic(path.resolve(flags['--json']), JSON.stringify(summary, null, 2) + '\n');
      if (flags['--junit']) writeAtomic(path.resolve(flags['--junit']), junit(summary));
      console.log(JSON.stringify(summary, null, 2)); if (!summary.passed) process.exitCode = 1;
    } finally { process.removeListener('SIGINT', interrupt); }
  } else if (command === 'import' || command === 'export') {
    if (!flags['--out']) throw new Error('--out is required');
    const result = command === 'import' ? importCollection(readJson(file)) : exportPostman(readJson(file));
    writeAtomic(path.resolve(flags['--out']), JSON.stringify(result.collection || result.data, null, 2) + '\n');
    for (const warning of result.warnings) console.error(warning);
  } else throw new Error('Unknown command: ' + command);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main, report, junit };
