'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { chromium, expect } = require('@playwright/test');
const { activateTextTools } = require('../../lib/text-extension');

test('text/JSON/Git workspace drives the real extension handler with local-only fixtures', async () => {
  const toolkit = path.resolve(__dirname, '../..'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-ui-'));
  function git(...args) {
    const result = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  }
  git('init', '-q'); fs.writeFileSync(path.join(root, 'sample.json'), '{"revision":1}\n'); git('add', '.'); git('commit', '-qm', 'Initial sample'); fs.writeFileSync(path.join(root, 'sample.json'), '{"revision":2}\n');
  let html, receive, provider, browser, page, clipboard = 'clipboard text';
  const commands = new Map(), diffs = [], errors = [];
  const fileUri = file => ({ fsPath: file, toString: () => file });
  const vscode = {
    ViewColumn: { One: 1 },
    Uri: { file: fileUri, joinPath: (base, ...parts) => fileUri(path.join(base.fsPath, ...parts)), from: value => ({ ...value, toString: () => value.scheme + ':' + value.path }) },
    workspace: { isTrusted: true, workspaceFolders: [{ uri: fileUri(root) }], registerTextDocumentContentProvider: (scheme, p) => { provider = p; return {}; }, onDidCloseTextDocument: () => ({}) },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return {}; }, executeCommand: async (...args) => { diffs.push(args); } },
    env: { clipboard: { readText: async () => clipboard, writeText: async () => {} } },
    window: {
      createWebviewPanel: () => ({ webview: { cspSource: "'self'", asWebviewUri: uri => '/media/' + path.basename(uri.fsPath), set html(value) { html = value; }, postMessage: message => page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), message), onDidReceiveMessage: fn => { receive = fn; } } }),
      showErrorMessage: message => errors.push(message), showInformationMessage: async () => {}, showQuickPick: async files => files[0]
    }
  };
  activateTextTools(vscode, { subscriptions: [], extensionPath: toolkit, extensionUri: fileUri(toolkit) });
  await commands.get('devkit.textTools')();
  const server = http.createServer((req, res) => {
    if (req.url === '/media/text-tools.js' || req.url === '/media/text-tools.css') {
      res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(fs.readFileSync(path.join(toolkit, req.url.slice(1)))); return;
    }
    res.setHeader('content-type', 'text/html'); res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await chromium.launch({ channel: process.env.DEVKIT_BROWSER || 'msedge', headless: true });
    page = await browser.newPage({ viewport: { width: 1360, height: 920 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.exposeFunction('sendToExtension', message => receive(message));
    await page.addInitScript(() => { window.acquireVsCodeApi = () => ({ postMessage: message => window.sendToExtension(message) }); });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.screenshot({ path: path.join(toolkit, 'dist/text-tools-initial.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await expect(page.locator('#left')).toBeVisible({ timeout: 3000 });
    const long = 'line of pasted content\n'.repeat(20000);
    await page.locator('#left').fill('Typed text');
    clipboard = long; await page.locator('[data-paste="left"]').click();
    await expect(page.locator('#status')).toContainText('Loaded Clipboard');
    await expect(page.locator('[data-paste="right"]')).toBeEnabled();
    clipboard = long + 'changed'; await page.locator('[data-paste="right"]').click();
    await expect(page.locator('#compare-button')).toBeEnabled();
    await page.locator('#compare-button').click();
    await expect(page.locator('#status')).toContainText('Comparison opened');
    assert.equal(provider.provideTextDocumentContent(diffs.at(-1)[1]), long);
    assert.equal(provider.provideTextDocumentContent(diffs.at(-1)[2]), long + 'changed');
    await page.locator('#swap').click(); assert.equal(await page.locator('#left').inputValue(), long + 'changed');
    await page.locator('#wrap').uncheck(); assert.equal(await page.locator('#left').evaluate(el => getComputedStyle(el).whiteSpace), 'pre');
    clipboard = 'clipboard text'; await page.locator('[data-paste="right"]').click(); await expect(page.locator('#right')).toHaveValue('clipboard text');
    await page.locator('[data-tab="json"]').click();
    const raw = '{"id":900719925474099312345,"items":[true,null]}';
    await page.locator('#json-input').fill(raw); await page.locator('[data-format="format"]').click();
    await expect(page.locator('#status')).toContainText('JSON formatted');
    assert.match(await page.locator('#json-input').inputValue(), /\n  "id": 900719925474099312345/);
    await page.locator('#json-undo').click(); assert.equal(await page.locator('#json-input').inputValue(), raw);
    await page.locator('#json-input').fill('{"broken":}'); await page.locator('[data-format="validate"]').click();
    await expect(page.locator('#status')).toContainText('Invalid JSON'); assert.equal(await page.locator('#json-input').inputValue(), '{"broken":}');
    await page.locator('[data-tab="git"]').click(); await page.locator('#repository').click();
    await expect(page.locator('#status')).toContainText('Repository selected');
    await page.locator('#changes').click(); await expect(page.locator('.changed-file')).toHaveCount(1);
    await expect(page.locator('#changes')).toBeEnabled();
    await page.locator('.changed-file').click(); await expect(page.locator('#status')).toContainText('Opened Git snapshots');
    assert.equal(provider.provideTextDocumentContent(diffs.at(-1)[1]), '{"revision":1}\n');
    assert.equal(provider.provideTextDocumentContent(diffs.at(-1)[2]), '{"revision":2}\n');
    await page.locator('#git-left').fill('HEAD~1'); await expect(page.locator('.changed-file')).toHaveCount(0);
    await page.locator('[data-tab="compare"]').click();
    await page.locator('#left').fill('{\n  "service": "orders",\n  "timeout": 3000,\n  "retry": false\n}');
    await page.locator('#right').fill('{\n  "service": "orders",\n  "timeout": 5000,\n  "retry": true,\n  "region": "ap-southeast-1"\n}');
    await page.locator('#wrap').check();
    fs.mkdirSync(path.join(toolkit, 'dist'), { recursive: true });
    await page.screenshot({ path: path.join(toolkit, 'dist/text-tools-preview.png'), fullPage: true });
    await page.setViewportSize({ width: 620, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
  } catch (error) {
    await page?.screenshot({ path: path.join(toolkit, 'dist/text-tools-failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
    throw new Error(error.message.slice(-1600));
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
  }
});
