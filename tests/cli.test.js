'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const cli = path.resolve(__dirname, '../cli.js');
function run(args) {
  return new Promise(resolve => { const child = spawn(process.execPath, [cli, ...args]); let stdout = '', stderr = ''; child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b); child.on('close', code => resolve({ code, stdout, stderr })); });
}
test('CLI writes reports, returns failure status, and accepts environment files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-cli-'));
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const file = path.join(root, 'collection.json'), env = path.join(root, 'env.json'), json = path.join(root, 'report.json'), xml = path.join(root, 'report.xml');
    fs.writeFileSync(env, JSON.stringify({ base: 'http://127.0.0.1:' + server.address().port }));
    const collection = { version: 1, requests: [{ url: '{{base}}', tests: [{ source: 'status', value: 200 }] }] };
    fs.writeFileSync(file, JSON.stringify(collection));
    const result = await run(['run', file, '--env', env, '--json', json, '--junit', xml]); assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(fs.readFileSync(json)).passed, true); assert.match(fs.readFileSync(xml, 'utf8'), /failures="0"/);
    collection.requests[0].tests[0].value = 404; fs.writeFileSync(file, JSON.stringify(collection));
    const failure = await run(['run', file, '--env', env]); assert.equal(failure.code, 1); assert.equal(JSON.parse(failure.stdout).passed, false);
    const request = path.join(root, 'request.json'), download = path.join(root, 'response.bin');
    fs.writeFileSync(request, JSON.stringify({ url: '{{base}}', tests: [{ source: 'status', value: 200 }] }));
    const sent = await run(['send', request, '--env', env, '--out', json, '--download', download]);
    assert.equal(sent.code, 0, sent.stderr); assert.deepEqual(JSON.parse(sent.stdout).json, { ok: true });
    assert.equal(fs.readFileSync(download, 'utf8'), '{"ok":true}');
    assert.equal(JSON.parse(fs.readFileSync(json)).variables, undefined);
    const template = await run(['curl', request]); assert.equal(template.code, 0, template.stderr); assert.match(template.stdout, /curl/);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true }); }
});
