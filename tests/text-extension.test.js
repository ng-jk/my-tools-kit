'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { activateTextTools } = require('../lib/text-extension');
test('diff snapshots preserve empty sides, support long text, normalize explicitly, and release on close', async () => {
  let provider, close; const calls = [];
  const vscode = {
    workspace: { registerTextDocumentContentProvider: (scheme, p) => { provider = p; return {}; }, onDidCloseTextDocument: fn => { close = fn; return {}; } },
    commands: { registerCommand: () => ({}), executeCommand: async (...args) => calls.push(args) },
    Uri: { from: value => ({ ...value, toString: () => value.scheme + ':' + value.path }) }, window: {}
  };
  const tools = activateTextTools(vscode, { subscriptions: [] });
  await tools.showDiff('', 'new', 'left', 'right');
  assert.equal(calls[0][0], 'vscode.diff'); assert.equal(provider.provideTextDocumentContent(calls[0][1]), '');
  assert.equal(provider.provideTextDocumentContent(calls[0][2]), 'new');
  const long = '0123456789\n'.repeat(100000);
  await tools.showDiff(long, long + 'changed', 'original', 'modified');
  assert.equal(provider.provideTextDocumentContent(calls[1][1]), long);
  assert.equal(await tools.showDiff(' A \r\n', 'a\n', 'A', 'B', { trimWhitespace: true, ignoreCase: true }), true);
  close({ uri: calls[0][1] }); assert.match(provider.provideTextDocumentContent(calls[0][1]), /expired/);
});
