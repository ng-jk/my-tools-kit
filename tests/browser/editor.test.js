'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('@playwright/test');
test('editor creates, edits, sends, imports and renders without executing response HTML', async () => {
  const root = path.resolve(__dirname, '../..');
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js' || req.url === '/style.css') { res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(fs.readFileSync(path.join(root, 'media', req.url.slice(1)))); return; }
    res.setHeader('content-type', 'text/html');
    res.end(fs.readFileSync(path.join(root, 'media/index.html'), 'utf8').replaceAll('{{CSP}}', "'self'").replaceAll('{{NONCE}}', 'test-nonce').replace('{{SCRIPT}}', '/app.js').replace('{{STYLE}}', '/style.css'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.DEVKIT_BROWSER || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.sent = []; window.acquireVsCodeApi = () => ({ postMessage: message => window.sent.push(message) }); });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('#name').fill('Create message'); await page.locator('#method').selectOption('POST'); await page.locator('#url').fill('http://127.0.0.1:4318/echo');
    await page.locator('[data-tab="body"]').click(); await page.locator('#bodyType').selectOption('json'); await page.locator('#body').fill('{"hello":"world"}');
    await page.locator('[data-tab="tests"]').click(); await page.locator('#addTest').click();
    await page.locator('#send').click();
    const sent = await page.evaluate(() => window.sent.at(-1)); assert.equal(sent.type, 'send'); assert.equal(sent.request.body.value.hello, 'world'); assert.equal(sent.request.tests[0].value, 200);
    assert.equal(await page.locator('#send').isDisabled(), true);
    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'result', result: { status: 200, time: 12, size: 40, passed: true, body: '<img src=x onerror="window.injected=true">', tests: [] } } }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'idle' } }));
    });
    assert.equal(await page.locator('#send').isDisabled(), false); assert.equal(await page.evaluate(() => !!window.injected), false);
    assert.match(await page.locator('#response').innerText(), /<img/);
    await page.locator('#duplicate').click(); assert.equal(await page.locator('.request-item').count(), 2);
    await page.locator('#save').click(); const saved = await page.evaluate(() => window.sent.at(-1)); assert.equal(saved.collection.requests.length, 2);
    await page.locator('#tests').fill('{broken'); await page.locator('#send').click(); assert.equal(await page.locator('#notice').getAttribute('class'), 'error');
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'collection', collection: { version: 1, name: 'Imported', requests: [{ name: 'Health', url: 'http://localhost/health', method: 'GET' }] }, warnings: ['Review imported scripts'] } })));
    assert.equal(await page.locator('#name').inputValue(), 'Health'); assert.match(await page.locator('#notice').innerText(), /Review imported scripts/);
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'dist/editor-preview.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
