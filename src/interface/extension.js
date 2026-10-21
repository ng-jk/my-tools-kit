'use strict';
const vscode = require('vscode');
const path = require('node:path');
const crypto = require('node:crypto');
const { execute, runCollection, flatten,CookieJar,dependencyRequests } = require('../logic/api');
const { importCollection, exportPostman, curl } = require('../logic/formats');
const { readBuffer, readJson, writeAtomic } = require('../data/files');
const { configurePipeline } = require('./pipeline-extension');
const {formatJson}=require('../logic/text-tools');

async function selectRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error('Open a project folder first');
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
  if (!folder) return;
  if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before using Development Tools Kit');
  return folder.uri.fsPath;
}
function activate(context) {
  const apiPanels=new Map();
  require('./sidebar').activateSidebar(vscode, context);
  require('./database-extension').activateDatabase(vscode, context);
  const sftp = require('../../build/sftp/extension');
  sftp.activate(context).catch(error => vscode.window.showErrorMessage('SFTP: ' + error.message));
  context.subscriptions.push({ dispose: () => sftp.deactivate() });
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
    if(apiPanels.has(root)){apiPanels.get(root).reveal(vscode.ViewColumn.One);return;}
    const panel = vscode.window.createWebviewPanel('devkit', 'Development Tools Kit', vscode.ViewColumn.One, { enableScripts: true,retainContextWhenHidden:true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
    apiPanels.set(root,panel);
    const nonce = crypto.randomBytes(24).toString('base64');
    const base = vscode.Uri.joinPath(context.extensionUri, 'media');
    panel.webview.html = readBuffer(path.join(context.extensionPath, 'media/index.html')).toString('utf8')
      .replaceAll('{{CSP}}', panel.webview.cspSource).replaceAll('{{NONCE}}', nonce)
      .replace('{{SCRIPT}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(base, 'app.js')).toString())
      .replace('{{STYLE}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(base, 'style.css')).toString());
    let controller;let draft;const jar=new CookieJar(),downloadPayloads=new Map();
    const post = value => panel.webview.postMessage(value);
    const confirmSave=async()=>await vscode.window.showWarningMessage('Save request data to a plain JSON file?',{modal:true,detail:'Requests, environments and libraries can include passwords, tokens, headers and body data. Prefer secret placeholders and keep credential files out of Git.'},'Save')==='Save';
    async function variables(data) {
      const values = { ...data.environment };
      for (const [key, value] of Object.entries(process.env)) values['env.' + key] = value;
      const requests=(data.type==='run'?flatten(data.collection):[data.request]).flatMap(request=>dependencyRequests(request,data.collections||[data.collection]));
      const source = JSON.stringify({requests,environment:data.environment});
      for (const match of source.matchAll(/\{\{\s*secret\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
        const value = await context.secrets.get(root + ':' + match[1]);
        if (value === undefined) throw new Error('Store the secret first: ' + match[1]);
        values['secret.' + match[1]] = value;
      }
      return values;
    }
    panel.onDidDispose(() => {controller?.abort();apiPanels.delete(root);draft=undefined;downloadPayloads.clear();});
    panel.webview.onDidReceiveMessage(async message => {
      try {
        if (!vscode.workspace.isTrusted) throw new Error('Workspace trust is required');
        if(message.type==='draft'){
          if(Buffer.byteLength(JSON.stringify(message.value))>32*1024*1024)throw new Error('Draft exceeds 32 MiB. Save a smaller request or use a binary file.');
          draft=message.value;
        }else if(message.type==='ready'){if(draft)await post({type:'draft',value:draft});}
        else if (message.type === 'send' || message.type === 'run') {
          if (controller) throw new Error('A request is already running');
          controller = new AbortController();
          try {
            const options = { root, variables: await variables(message), signal: controller.signal, allowScripts: !!message.allowScripts,collections:message.collections||[message.collection],jar };
            const result = message.type === 'send' ? await execute(message.request, options) : await runCollection(message.collection, options);
            const key=message.requestKey||message.request?.id||'legacy';
            if(message.type==='send'){downloadPayloads.set(key,result.base64);if(downloadPayloads.size>6)downloadPayloads.delete(downloadPayloads.keys().next().value);}else downloadPayloads.delete(key);
            // Never persist resolved requests, responses or credentials to workspace state.
            await post({ type: 'result',requestKey:message.requestKey, result: message.type === 'send' ? { ...result, variables: undefined, base64: undefined } : { passed: result.passed, results: result.results.map(r => ({ status: r.status, time: r.time, passed: r.passed, tests: r.tests, error: r.error })) } });
          } finally { controller = undefined; await post({ type: 'idle' }); }
        } else if (message.type === 'cancel') controller?.abort();
        else if(message.type==='formatBody'){await post({type:'bodyFormatted',original:message.text,text:formatJson(message.text,{indent:2})});}
        else if(message.type==='copyResponse'){await vscode.env.clipboard.writeText(String(message.text||''));await post({type:'notice',text:'Response copied.'});}
        else if(message.type==='saveLibrary'){
          if(!await confirmSave())return;
          const target=await vscode.window.showSaveDialog({defaultUri:vscode.Uri.file(path.join(root,'api-library.json')),filters:{JSON:['json']}});
          if(target){writeAtomic(target.fsPath,JSON.stringify(message.collections,null,2)+'\n');await post({type:'notice',text:'Library saved. Use --collections with CLI send/run.'});}
        }
        else if (message.type === 'save') {
          if(!await confirmSave())return;
          const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(root, 'api-collection.json')), filters: { JSON: ['json'] } });
          if (target) { writeAtomic(target.fsPath, JSON.stringify(message.collection, null, 2) + '\n'); await post({ type: 'notice', text: 'Saved ' + target.fsPath }); }
        } else if (message.type === 'saveRequest' || message.type === 'exportPostman') {
          if(!await confirmSave())return;
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
          if(!await confirmSave())return;
          const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(root, 'environment.local.json')), filters: { JSON: ['json'] } });
          if (target) writeAtomic(target.fsPath, JSON.stringify(message.environment, null, 2) + '\n');
        } else if (message.type === 'download') {
          const body=downloadPayloads.get(message.requestKey||'legacy');
          if(body===undefined)throw new Error('No retained response for this request. Send it again before saving.');
          const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(root, 'response.bin')) });
          if (target) writeAtomic(target.fsPath, Buffer.from(body, 'base64'));
        } else if (message.type === 'curl') { await vscode.env.clipboard.writeText(curl(message.request)); await post({ type: 'notice', text: 'POSIX cURL template copied. Auth, query fields and non-raw bodies require manual mapping.' }); }
        else if (message.type === 'pipeline') await configure();
        else if (message.type === 'secret') await vscode.commands.executeCommand('devkit.secret');
        else if (message.type === 'textTools') await vscode.commands.executeCommand('devkit.textTools');
      } catch (e) { await post({ type: 'error', text: e.message }); }
    });
  });
}
module.exports = { activate, deactivate() {} };
