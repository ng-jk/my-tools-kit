'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const compare = require('../lib/git-compare');

test('Git comparisons read commit, index and working-tree snapshots without changing checkout', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-git-'));
  function git(...args) {
    const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=DevKit Test', '-c', 'user.email=devkit@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  }
  try {
    git('init', '-q');
    fs.writeFileSync(path.join(root, 'unchanged name.txt'), 'unchanged\n');
    fs.writeFileSync(path.join(root, 'data.json'), '{"v":1}\n');
    fs.writeFileSync(path.join(root, 'gone.txt'), 'removed later\n');
    fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    git('add', '.'); git('commit', '-qm', 'first'); const first = git('rev-parse', 'HEAD');
    git('mv', 'unchanged name.txt', 'renamed name.txt');
    fs.writeFileSync(path.join(root, 'data.json'), '{"v":2}\n'); fs.unlinkSync(path.join(root, 'gone.txt'));
    fs.writeFileSync(path.join(root, 'added.txt'), 'new\n');
    git('add', '.'); git('commit', '-qm', 'second'); const second = git('rev-parse', 'HEAD');
    const rootResult = await compare.repository(root); assert.equal(path.resolve(rootResult), path.resolve(root));
    const history = await compare.history(root); assert.equal(history[0].sha, second); assert.equal(history[1].subject, 'first');
    const range = await compare.changes(root, first, second);
    assert.equal(range.files.some(f => f.status.startsWith('R') && f.leftPath === 'unchanged name.txt' && f.rightPath === 'renamed name.txt'), true);
    assert.equal(range.files.some(f => f.status === 'A' && f.rightPath === 'added.txt'), true);
    assert.equal(range.files.some(f => f.status === 'D' && f.leftPath === 'gone.txt'), true);
    assert.equal((await compare.readFile(root, first, 'data.json')).buffer.toString(), '{"v":1}\n');
    assert.equal((await compare.readFile(root, second, 'data.json')).buffer.toString(), '{"v":2}\n');
    assert.equal((await compare.readFile(root, first, 'added.txt')).exists, false);
    assert.equal((await compare.readFile(root, second, null)).exists, false);
    assert.equal((await compare.listFiles(root, first)).includes('unchanged name.txt'), true);
    fs.writeFileSync(path.join(root, 'data.json'), '{"v":3}\n'); git('add', 'data.json');
    fs.writeFileSync(path.join(root, 'data.json'), '{"v":4}\n'); fs.writeFileSync(path.join(root, 'untracked.txt'), 'local');
    const before = git('status', '--porcelain=v1');
    assert.equal((await compare.readFile(root, 'INDEX', 'data.json')).buffer.toString(), '{"v":3}\n');
    assert.equal((await compare.readFile(root, 'WORKTREE', 'data.json')).buffer.toString(), '{"v":4}\n');
    assert.equal((await compare.changes(root, 'HEAD', 'INDEX')).files.some(f => f.rightPath === 'data.json'), true);
    assert.equal((await compare.changes(root, 'HEAD', 'WORKTREE')).files.some(f => f.status === '?' && f.rightPath === 'untracked.txt'), true);
    assert.equal(git('status', '--porcelain=v1'), before); assert.equal(git('rev-parse', 'HEAD'), second);
    await assert.rejects(compare.resolveRevision(root, '--help'), /Git:/);
    await assert.rejects(compare.readFile(root, 'WORKTREE', '../outside'), /relative path/);
    await assert.rejects(compare.changes(root, 'WORKTREE', 'HEAD'), /left revision/);
    await assert.rejects(compare.resolveRevision(root, 'invalid-revision'), /Git:/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
