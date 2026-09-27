'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execute, runCollection, substitute } = require('../lib/api');
const { importCollection } = require('../lib/formats');
const { report, junit } = require('../cli');
let server, base;
before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (req.url === '/slow') { setTimeout(() => res.end('late'), 150); return; }
    if (req.url === '/redirect') { res.writeHead(302, { location: '/echo', 'set-cookie': 'session=abc; Path=/' }); res.end(); return; }
    if (req.url === '/external') { res.writeHead(302, { location: 'http://localhost:1/' }); res.end(); return; }
    if (req.url === '/large') { res.end('x'.repeat(1000)); return; }
    if (req.url === '/token') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ access_token: 'oauth-token' })); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString(), id: 42 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise(resolve => server.close(resolve)));
test('JSON, query substitution, basic auth, and assertions use actual wire response', async () => {
  const result = await execute({ url: base + '/echo', method: 'POST', query: { q: '{{term}}' }, auth: { type: 'basic', username: 'alice', password: 'secret' }, body: { type: 'json', value: { message: '{{term}}' } }, tests: [{ source: 'status', value: 200 }, { source: 'json', path: 'id', value: 42 }] }, { variables: { term: 'hello world' } });
  assert.equal(result.json.url, '/echo?q=hello+world'); assert.equal(result.json.headers.authorization, 'Basic YWxpY2U6c2VjcmV0'); assert.equal(JSON.parse(result.json.body).message, 'hello world'); assert.equal(result.passed, true);
});
test('form, OAuth client credentials and bearer auth', async () => {
  const result = await execute({ url: base + '/echo', method: 'POST', auth: { type: 'oauth2', tokenUrl: base + '/token', clientId: 'client', clientSecret: 'secret' }, body: { type: 'form', value: { name: 'A B' } } });
  assert.equal(result.json.headers.authorization, 'Bearer oauth-token'); assert.equal(result.json.body, 'name=A+B');
});
test('redirect cookies and cross-origin credential boundary', async () => {
  const result = await execute({ url: base + '/redirect' }); assert.equal(result.json.headers.cookie, 'session=abc');
  await assert.rejects(execute({ url: base + '/external', auth: { type: 'bearer', token: 'secret' } }), /Cross-origin/);
});
test('timeout, cancellation, and maximum response size', async () => {
  await assert.rejects(execute({ url: base + '/slow', timeout: 10 }), /timeout/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(execute({ url: base + '/slow' }, { signal: controller.signal }), /abort/i);
  await assert.rejects(execute({ url: base + '/large' }, { maxBytes: 50 }), /size limit/);
});
test('collection extraction and trusted scripts chain variables', async () => {
  const run = await runCollection({ version: 1, requests: [
    { url: base + '/echo', extract: [{ variable: 'id', path: 'id' }] },
    { url: base + '/{{id}}', preScript: 'env.set("greeting", "hello");', postScript: 'test("id is 42", () => assert(response.json.id === 42)); env.set("done", true);' }
  ] }, { allowScripts: true });
  assert.equal(run.passed, true); assert.equal(run.results[1].json.url, '/42'); assert.equal(run.variables.done, true);
});
test('scripts are opt-in, bounded, and failing assertions fail the run', async () => {
  await assert.rejects(execute({ url: base, preScript: 'env.set("a", 1)' }), /trusted/);
  await assert.rejects(execute({ url: base, preScript: 'while (true) {}' }, { allowScripts: true }), /timed out|timeout/i);
  const r = await execute({ url: base, tests: [{ source: 'status', value: 404 }] }); assert.equal(r.passed, false);
  const asyncTest = await execute({ url: base, postScript: 'test("async failure", async () => { await Promise.resolve(); assert(false, "expected failure"); });' }, { allowScripts: true });
  assert.equal(asyncTest.passed, false); assert.match(asyncTest.tests[0].error, /expected failure/);
  assert.equal((await runCollection({ version: 1, requests: [] })).passed, false);
});
test('multipart and binary uploads constrain paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-api-'));
  try {
    fs.writeFileSync(path.join(root, 'input.bin'), Buffer.from([65, 66, 67]));
    const binary = await execute({ url: base, method: 'POST', body: { type: 'binary', file: 'input.bin' } }, { root }); assert.equal(binary.json.body, 'ABC');
    const multipart = await execute({ url: base, method: 'POST', body: { type: 'multipart', fields: [{ name: 'file', file: 'input.bin' }, { name: 'name', value: 'demo' }] } }, { root }); assert.match(multipart.json.body, /filename="input.bin"/); assert.match(multipart.json.body, /ABC/);
    await assert.rejects(execute({ url: base, method: 'POST', body: { type: 'binary', file: '../escape.txt' } }, { root }), /escapes/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test('missing variables and unsupported auth fail explicitly', async () => {
  assert.throws(() => substitute('{{missing}}', {}), /Missing variable/);
  await assert.rejects(execute({ url: base, auth: { type: 'ntlm' } }), /Unsupported/);
  assert.equal(substitute('{{token}}', { token: '{{secret.TOKEN}}', 'secret.TOKEN': 'resolved' }), 'resolved');
  assert.throws(() => substitute('{{a}}', { a: '{{b}}', b: '{{a}}' }), /Circular/);
});
test('nested folders retain inherited scripts and headers', async () => {
  const run = await runCollection({ version: 1, defaults: { headers: { 'x-root': 'root' }, preScript: 'env.set("a", "A")' }, folders: [{ defaults: { headers: { 'x-folder': 'folder' }, preScript: 'env.set("b", env.get("a") + "B")' }, requests: [{ url: base, headers: [{ name: 'x-request', value: 'request' }], preScript: 'env.set("c", env.get("b") + "C")' }] }] }, { allowScripts: true });
  assert.equal(run.passed, true); assert.equal(run.variables.c, 'ABC'); assert.equal(run.results[0].json.headers['x-root'], 'root'); assert.equal(run.results[0].json.headers['x-request'], 'request');
});
test('portable import retains raw requests and warns about scripts', () => {
  const result = importCollection({ info: { name: 'demo' }, item: [{ name: 'get', request: { method: 'GET', url: { raw: base } }, event: [{ script: {} }] }] });
  assert.equal(result.collection.requests[0].url, base); assert.equal(result.warnings.length, 1);
});
test('reports omit credential-bearing content', () => {
  const summary = report({ passed: false, results: [{ name: 'secret', headers: { authorization: 'secret' }, body: 'secret', error: 'secret', variables: { key: 'secret' }, tests: [{ name: 'secret', error: 'secret', passed: false }] }] });
  assert.equal(JSON.stringify(summary).includes('secret'), false); assert.equal(junit(summary).includes('secret'), false);
});
