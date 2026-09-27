'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const cli = path.resolve(__dirname, '../cli.js');
test('JSON CLI preserves large numbers and reports invalid JSON', () => {
  const result = spawnSync(process.execPath, [cli, 'json', '-', '--minify'], { input: '{ "id": 9007199254740993 }', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '{"id":9007199254740993}');
  assert.notEqual(spawnSync(process.execPath, [cli, 'json', '-'], { input: '{invalid}', encoding: 'utf8' }).status, 0);
});
test('long pasted text comparison returns explicit equality and exit status', () => {
  const left = 'a long line\n'.repeat(20000);
  for (const [right, status] of [[left, 0], [left + 'changed', 1]]) {
    const result = spawnSync(process.execPath, [cli, 'compare', '-', '-'], { input: JSON.stringify({ left, right }), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, status, result.stderr);
    assert.equal(JSON.parse(result.stdout).identical, status === 0);
  }
});
test('comparison accepts either single stdin operand with a file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-stdin-'));
  try {
    const file = path.join(root, 'text.txt'); fs.writeFileSync(file, 'a long paste\n'.repeat(20000));
    for (const operands of [['-', file], [file, '-']]) {
      const result = spawnSync(process.execPath, [cli, 'compare', ...operands], { input: fs.readFileSync(file), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).identical, true);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('Git CLI rejects two missing paths and permits an added file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-missing-git-'));
  try {
    const git = (...args) => { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    fs.writeFileSync(path.join(root, 'exists.txt'), 'content'); git('add', '.'); git('commit', '-m', 'fixture');
    const missing = spawnSync(process.execPath, [cli, 'git-compare', root, 'HEAD', 'HEAD', 'typo.txt'], { encoding: 'utf8' });
    assert.equal(missing.status, 2); assert.match(missing.stderr, /Neither Git file exists/);
    const added = spawnSync(process.execPath, [cli, 'git-compare', root, 'HEAD', 'HEAD', '-', 'exists.txt'], { encoding: 'utf8' });
    assert.equal(added.status, 1, added.stderr); assert.equal(JSON.parse(added.stdout).right, 'content');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
