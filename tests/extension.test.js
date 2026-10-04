'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('extension host bridge executes requests and persists no response credentials', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-extension-'));
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ authorization: req.headers.authorization })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const commands = new Map(), messages = []; let receive;
  const uri = file => ({ fsPath: file, toString: () => file });
  const vscode = {
    ThemeIcon: class { constructor(id) { this.id = id; } },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return { dispose() {} }; } },
    workspace: { isTrusted: true, workspaceFolders: [{ uri: uri(root) }], registerTextDocumentContentProvider: () => ({ dispose() {} }), onDidCloseTextDocument: () => ({ dispose() {} }) },
    ViewColumn: { One: 1 }, Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    window: { registerTreeDataProvider: () => ({dispose(){}}), createWebviewPanel: () => ({ onDidDispose() {}, webview: { cspSource: 'test:', asWebviewUri: x => x, postMessage: data => messages.push(data), onDidReceiveMessage: handler => receive = handler } }), showErrorMessage: message => { throw new Error(message); } }
  };
  const original = Module._load;
  try {
    Module._load = function (id, ...args) { return id === 'vscode' ? vscode : id.endsWith('/build/sftp/extension') ? {activate:async()=>{},deactivate(){}} : original.call(this, id, ...args); };
    const { activate } = require('../extension');
    const extensionPath = path.resolve(__dirname, '..');
    activate({ subscriptions: [], extensionPath, extensionUri: uri(extensionPath), secrets: { get: async name => name.endsWith(':TOKEN') ? 'fixture-secret' : undefined } });
    await commands.get('devkit.open')();
    await receive({ type: 'send', request: { url: 'http://127.0.0.1:' + server.address().port, auth: { type: 'bearer', token: '{{token}}' } }, environment: { token: '{{secret.TOKEN}}' } });
    const result = messages.find(m => m.type === 'result').result;
    assert.equal(result.json.authorization, 'Bearer fixture-secret'); assert.equal(result.variables, undefined); assert.equal(result.base64, undefined);
    assert.equal(fs.readdirSync(root).length, 0);
    vscode.workspace.isTrusted = false;
    await receive({ type: 'send', request: { url: 'http://127.0.0.1:' + server.address().port } });
    assert.match(messages.at(-1).text, /trust/);
  } finally { Module._load = original; await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true }); }
});
