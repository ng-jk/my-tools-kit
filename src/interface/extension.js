'use strict';
const vscode = require('vscode');
const path = require('node:path');
const crypto = require('node:crypto');
const { execute, runCollection, flatten } = require('../logic/api');
const { importCollection, exportPostman, curl } = require('../logic/formats');
const { readBuffer, readJson, writeAtomic } = require('../data/files');
const { configurePipeline } = require('./pipeline-extension');

async function selectRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error('Open a project folder first');
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
  if (!folder) return;
  if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before using Development Tools Kit');
  return folder.uri.fsPath;
}
function activate(context) {
  require('./text-extension').activateTextTools(vscode, context);
  const register = (name, fn) => context.subscriptions.push(vscode.commands.registerCommand(name, async () => { try { await fn(); } catch (e) { vscode.window.showErrorMessage(e.message); } }));
  register('devkit.secret', async () => {
    const root = await selectRoot(); if (!root) return;
    const name = await vscode.window.showInputBox({ prompt: 'Secret name (use {{secret.NAME}} in a request)', validateInput: v => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? undefined : 'Use letters, numbers, and underscores' });
    if (!name) return;
    const value = await vscode.window.showInputBox({ prompt: 'Secret value', password: true });
    if (value !== undefined) await context.secrets.store(root + ':' + name, value);
  });
  async function configure() { const root = await selectRoot(); if (root) await configurePipeline(vscode, context, root); }
  register('devkit.pipeline', configure);
  register('devkit.open', async () => {
    const root = await selectRoot(); if (!root) return;
    const panel = vscode.window.createWebviewPanel('devkit', 'Development Tools Kit', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
    const nonce = crypto.randomBytes(24).toString('base64');
    const base = vscode.Uri.joinPath(context.extensionUri, 'media');
    panel.webview.html = readBuffer(path.join(context.extensionPath, 'media/index.html')).toString('utf8')
      .replaceAll('{{CSP}}', panel.webview.cspSource).replaceAll('{{NONCE}}', nonce)
      .replace('{{SCRIPT}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(base, 'app.js')).toString())
      .replace('{{STYLE}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(base, 'style.css')).toString());
    let controller; let lastResponse;
    const post = value => panel.webview.postMessage(value);
    async function variables(data) {
      const values = { ...data.environment };
      for (const [key, value] of Object.entries(process.env)) values['env.' + key] = value;
      const source = JSON.stringify({ request: data.request, collection: data.collection, environment: data.environment });
      for (const match of source.matchAll(/\{\{\s*secret\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
        const value = await context.secrets.get(root + ':' + match[1]);
        if (value === undefined) throw new Error('Store the secret first: ' + match[1]);
        values['secret.' + match[1]] = value;
      }
      return values;
    }
    panel.onDidDispose(() => controller?.abort());
    panel.webview.onDidReceiveMessage(async message => {
      try {
        if (!vscode.workspace.isTrusted) throw new Error('Workspace trust is required');
        if (message.type === 'send' || message.type === 'run') {
          if (controller) throw new Error('A request is already running');
          controller = new AbortController();
          try {
            const options = { root, variables: await variables(message), signal: controller.signal, allowScripts: !!message.allowScripts };
            const result = message.type === 'send' ? await execute(message.request, options) : await runCollection(message.collection, options);
            lastResponse = message.type === 'send' ? result : null;
            // Never persist resolved requests, responses or credentials to workspace state.
            await post({ type: 'result', result: message.type === 'send' ? { ...result, variables: undefined, base64: undefined } : { passed: result.passed, results: result.results.map(r => ({ status: r.status, time: r.time, passed: r.passed, tests: r.tests, error: r.error })) } });
          } finally { controller = undefined; await post({ type: 'idle' }); }
        } else if (message.type === 'cancel') controller?.abort();
        else if (message.type === 'save') {
          const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(root, 'api-collection.json')), filters: { JSON: ['json'] } });
          if (target) { writeAtomic(target.fsPath, JSON.stringify(message.collection, null, 2) + '\n'); await post({ type: 'notice', text: 'Saved ' + target.fsPath }); }
        } else if (message.type === 'saveRequest' || message.type === 'exportPostman') {
          const result = message.type === 'saveRequest' ? { data: message.request, warnings: [] } : exportPostman(message.collection);
          const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(root, message.type === 'saveRequest' ? 'request.json' : 'postman-collection.json')), filters: { JSON: ['json'] } });
          if (target) { writeAtomic(target.fsPath, JSON.stringify(result.data, null, 2) + '\n'); await post({ type: 'notice', text: ['Saved ' + target.fsPath, ...result.warnings].join('\n') }); }
        } else if (message.type === 'open') {
          const selected = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] } });
          if (selected?.[0]) {
            const result = importCollection(readJson(selected[0].fsPath));
            if (result.collection.folders?.length || result.collection.defaults) {
              result.collection = { ...result.collection, requests: flatten(result.collection), folders: undefined, defaults: undefined };
              result.warnings.push('Folder hierarchy was flattened for the editor; effective headers and scripts were retained. Keep the original file for folder-based editing.');
            }
            await post({ type: 'collection', ...result });
          }
        } else if (message.type === 'openEnvironment') {
          const selected = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] } });
          if (selected?.[0]) await post({ type: 'environment', value: readJson(selected[0].fsPath) });
        } else if (message.type === 'saveEnvironment') {
          const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(root, 'environment.local.json')), filters: { JSON: ['json'] } });
          if (target) writeAtomic(target.fsPath, JSON.stringify(message.environment, null, 2) + '\n');
        } else if (message.type === 'download' && lastResponse) {
          const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(root, 'response.bin')) });
          if (target) writeAtomic(target.fsPath, Buffer.from(lastResponse.base64, 'base64'));
        } else if (message.type === 'curl') { await vscode.env.clipboard.writeText(curl(message.request)); await post({ type: 'notice', text: 'POSIX cURL template copied. Auth, query fields and non-raw bodies require manual mapping.' }); }
        else if (message.type === 'pipeline') await configure();
        else if (message.type === 'secret') await vscode.commands.executeCommand('devkit.secret');
        else if (message.type === 'textTools') await vscode.commands.executeCommand('devkit.textTools');
      } catch (e) { await post({ type: 'error', text: e.message }); }
    });
  });
}
module.exports = { activate, deactivate() {} };
