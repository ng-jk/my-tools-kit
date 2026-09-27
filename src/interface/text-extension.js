'use strict';
const { readLocal } = require('../data/local-files');
const path = require('node:path');
const crypto = require('node:crypto');
const { formatJson, normalizeText, decodeText, MAX_TEXT } = require('../logic/text-tools');
const git = require('../logic/git-compare');

function activateTextTools(vscode, context) {
  const snapshots = new Map();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('devkit-compare', {
    provideTextDocumentContent: uri => snapshots.get(uri.toString()) ?? 'This session snapshot has expired. Open a new comparison.'
  }));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => snapshots.delete(document.uri.toString())));
  const register = (name, fn) => context.subscriptions.push(vscode.commands.registerCommand(name, async (...args) => {
    try { await fn(...args); } catch (e) { vscode.window.showErrorMessage(e.message); }
  }));
  async function showDiff(left, right, leftName = 'Left.txt', rightName = 'Right.txt', options = {}) {
    const a = normalizeText(left, options), b = normalizeText(right, options);
    const memory = [...snapshots.values()].reduce((total, value) => total + Buffer.byteLength(value), 0);
    if (memory + Buffer.byteLength(a) + Buffer.byteLength(b) > MAX_TEXT * 6) throw new Error('Close older comparison tabs before opening more large snapshots.');
    const id = crypto.randomUUID();
    const makeUri = (side, label) => vscode.Uri.from({ scheme: 'devkit-compare', path: `/${id}/${side}-${path.basename(label).replace(/[\r\n]/g, '_')}${options.json ? '.json' : ''}` });
    const leftUri = makeUri('left', leftName), rightUri = makeUri('right', rightName);
    snapshots.set(leftUri.toString(), a); snapshots.set(rightUri.toString(), b);
    try {
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${leftName} ↔ ${rightName}${options.json || options.trimWhitespace || options.ignoreCase || options.lineEndings ? ' (normalized)' : ''}`, { preview: false });
    } catch (e) { snapshots.delete(leftUri.toString()); snapshots.delete(rightUri.toString()); throw e; }
    return a === b;
  }
  async function compareFiles(first, selection) {
    let files = selection?.length === 2 ? selection : undefined;
    if (!files) files = await vscode.window.showOpenDialog({ title: 'Choose exactly two files to compare', canSelectMany: true, canSelectFiles: true, canSelectFolders: false });
    if (!files) return;
    if (files.length !== 2) throw new Error('Choose exactly two files.');
    const pair = git.compareBuffers(...await Promise.all(files.map(f => readLocal(f.fsPath))));
    await showDiff(pair.left, pair.right, files[0].fsPath, files[1].fsPath);
    if (pair.binary) vscode.window.showInformationMessage(pair.identical ? 'Binary files are byte-for-byte identical.' : 'Binary files differ. Showing sizes, hashes and a hex excerpt at the first difference.');
  }
  async function chooseRepository() {
    let selected;
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length) {
      const choice = await vscode.window.showQuickPick([
        ...folders.map(folder => ({ label: folder.name || path.basename(folder.uri.fsPath), description: folder.uri.fsPath, uri: folder.uri })),
        { label: 'Browse for another repository…', browse: true }
      ], { title: 'Choose a Git repository' });
      if (!choice) return;
      selected = choice.uri;
      if (choice.browse) selected = (await vscode.window.showOpenDialog({ title: 'Choose a Git repository', canSelectFolders: true, canSelectFiles: false, canSelectMany: false }))?.[0];
    } else selected = (await vscode.window.showOpenDialog({ title: 'Choose a Git repository', canSelectFolders: true, canSelectFiles: false, canSelectMany: false }))?.[0];
    if (selected) return git.repository(selected.fsPath);
  }
  async function open(mode = 'compare') {
    const seedEditor = vscode.window.activeTextEditor;
    const seed = mode === 'json' && seedEditor ? seedEditor.document.getText(seedEditor.selection.isEmpty ? undefined : seedEditor.selection) : '';
    const panel = vscode.window.createWebviewPanel('devkit.textTools', 'Text & JSON Tools', vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    });
    const nonce = crypto.randomBytes(24).toString('base64'), media = vscode.Uri.joinPath(context.extensionUri, 'media');
    panel.webview.html = (await readLocal(path.join(context.extensionPath, 'media/text-tools.html'))).toString('utf8')
      .replaceAll('{{CSP}}', panel.webview.cspSource).replaceAll('{{NONCE}}', nonce)
      .replace('{{SCRIPT}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'text-tools.js')).toString())
      .replace('{{STYLE}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'text-tools.css')).toString());
    let root, changeSet, running = false;
    const post = message => panel.webview.postMessage(message);
    async function openGitPair(leftRevision, rightRevision, leftPath, rightPath) {
      if (!root) throw new Error('Select a repository first.');
      const [a, b] = await Promise.all([git.readFile(root, leftRevision, leftPath), git.readFile(root, rightRevision, rightPath)]);
      if (!a.exists && !b.exists) throw new Error('Neither file exists at the selected revisions. Check the paths.');
      const pair = git.compareBuffers(a.buffer, b.buffer);
      const leftLabel = `${a.exists ? leftRevision.slice(0, 10) : 'absent'} · ${leftPath || rightPath}`;
      const rightLabel = `${b.exists ? rightRevision.slice(0, 10) : 'absent'} · ${rightPath || leftPath}`;
      await showDiff(pair.left, pair.right, leftLabel, rightLabel);
      await post({ type: 'notice', text: pair.binary ? 'Opened a binary summary with hashes and the first differing byte.' : 'Opened Git snapshots. Your working files were not changed.' });
    }
    panel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'ready') { await post({ type: 'init', mode, seed }); return; }
      if (running) return;
      running = true;
      try {
        if (message.type === 'compare') {
          const identical = await showDiff(message.left, message.right, message.leftName || 'Left.txt', message.rightName || 'Right.txt', message.options || {});
          await post({ type: 'notice', text: identical ? 'The two texts are identical under the selected options.' : 'Comparison opened. Use the diff toolbar to jump between changes or switch to inline view.' });
        } else if (message.type === 'format') {
          const output = formatJson(message.text, { indent: message.indent, minify: message.action === 'minify' });
          await post({ type: 'formatted', text: message.action === 'validate' ? message.text : output, action: message.action });
        } else if (message.type === 'clipboard') {
          const text = await vscode.env.clipboard.readText();
          if (Buffer.byteLength(text) > MAX_TEXT) throw new Error('Clipboard exceeds 20 MiB.');
          await post({ type: 'loaded', side: message.side, text, name: 'Clipboard' });
        } else if (message.type === 'load') {
          const files = await vscode.window.showOpenDialog({ title: 'Load text or JSON', canSelectMany: false });
          if (files?.[0]) {
            const text = decodeText(await readLocal(files[0].fsPath));
            if (text === null) throw new Error('This is binary or non-UTF text. Use Compare Two Files for a binary summary.');
            await post({ type: 'loaded', side: message.side, text, name: path.basename(files[0].fsPath) });
          }
        } else if (message.type === 'copy') {
          await vscode.env.clipboard.writeText(message.text); await post({ type: 'notice', text: 'Copied to clipboard.' });
        } else if (message.type === 'openJson') {
          const doc = await vscode.workspace.openTextDocument({ language: 'json', content: message.text });
          await vscode.window.showTextDocument(doc, { preview: false });
        } else if (message.type === 'saveJson') {
          const directory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || require('node:os').homedir();
          const file = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(directory, 'formatted.json')), filters: { JSON: ['json'] } });
          if (file) { await vscode.workspace.fs.writeFile(file, Buffer.from(message.text)); await post({ type: 'notice', text: 'JSON saved.' }); }
        } else if (message.type === 'files') await compareFiles();
        else if (message.type === 'repository') {
          if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before reading Git repositories.');
          const selected = await chooseRepository();
          if (selected) { root = selected; changeSet = undefined; await post({ type: 'repository', root, commits: await git.history(root) }); }
        } else if (message.type === 'changes') {
          if (!root) throw new Error('Select a repository first.');
          changeSet = undefined;
          changeSet = await git.changes(root, message.left, message.right);
          await post({ type: 'changes', files: changeSet.files });
        } else if (message.type === 'gitFile') {
          if (!changeSet || !Number.isInteger(message.index) || !changeSet.files[message.index]) throw new Error('Refresh the changed-file list first.');
          const file = changeSet.files[message.index];
          await openGitPair(changeSet.left, changeSet.right, file.leftPath, file.rightPath);
        } else if (message.type === 'choosePath') {
          if (!root) throw new Error('Select a repository first.');
          const files = await git.listFiles(root, message.revision);
          const selected = await vscode.window.showQuickPick(files, { title: `Select a file at ${message.revision}`, matchOnDescription: true });
          if (selected) await post({ type: 'path', side: message.side, path: selected });
        } else if (message.type === 'gitPaths') {
          if (!root) throw new Error('Select a repository first.');
          const [left, right] = await Promise.all([git.resolveRevision(root, message.left), git.resolveRevision(root, message.right)]);
          await openGitPair(left, right, message.leftPath, message.rightPath || message.leftPath);
        }
      } catch (e) { await post({ type: 'error', text: e.message }); }
      finally { running = false; await post({ type: 'idle' }); }
    });
  }
  register('devkit.textTools', () => open());
  register('devkit.jsonFormatter', () => open('json'));
  register('devkit.compareGit', () => open('git'));
  register('devkit.compareFiles', compareFiles);
  register('devkit.compareClipboard', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('Open an editor or select text first.');
    await showDiff(editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection), await vscode.env.clipboard.readText(), path.basename(editor.document.fileName), 'Clipboard.txt');
  });
  register('devkit.formatJson', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('Open a JSON document or select JSON text first.');
    const selection = editor.selection;
    const range = selection.isEmpty ? new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)) : selection;
    const output = formatJson(editor.document.getText(range), { indent: editor.options.insertSpaces === false ? 'tab' : editor.options.tabSize });
    if (!await editor.edit(builder => builder.replace(range, output))) throw new Error('The document changed. Try formatting again.');
  });
  return { showDiff };
}
module.exports = { activateTextTools };
