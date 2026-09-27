'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
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
