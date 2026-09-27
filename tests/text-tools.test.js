'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatJson, normalizeText, decodeText, MAX_TEXT } = require('../lib/text-tools');
const { compareBuffers, parseChanges } = require('../lib/git-compare');

test('JSON formatting preserves large integers, exponents, duplicate keys and escapes', () => {
  const raw = '{"id":9007199254740993123456789,"n":1.2300e+55,"zero":-0,"a":"\\u0061","a":"comma, colon: brace} and quote\\\"","empty":{},"array":[[],true,null]}';
  const formatted = formatJson(raw);
  assert.equal(formatJson(formatted, { minify: true }), raw);
  assert.match(formatted, /\n  "id": 9007199254740993123456789/);
  assert.match(formatJson(raw, { indent: 4 }), /\n    "id"/);
  assert.match(formatJson(raw, { indent: 'tab' }), /\n\t"id"/);
  assert.equal(formatJson('  true \n'), 'true');
  assert.equal(formatJson('\uFEFF{"x":1}', { minify: true }), '{"x":1}');
});
test('JSON errors and excessive inputs fail without returning modified content', () => {
  for (const raw of ['{"x":}', '{"x":01}', '{"x":1,}', '/* comment */{}', '']) assert.throws(() => formatJson(raw), /Invalid JSON/);
  assert.throws(() => formatJson('['.repeat(257) + '0' + ']'.repeat(257)), /nesting/);
  assert.throws(() => normalizeText('x'.repeat(MAX_TEXT + 1)), /20 MiB/);
});
test('comparison normalization is opt-in and supports long pasted text', () => {
  const raw = ' A \r\n B\r\n';
  assert.equal(normalizeText(raw), raw);
  assert.equal(normalizeText(raw, { trimWhitespace: true, ignoreCase: true }), 'a\nb\n');
  assert.equal(normalizeText(raw, { lineEndings: true }), ' A \n B\n');
  assert.equal(normalizeText('{"x":1}', { json: true }), '{\n  "x": 1\n}');
  const long = Array.from({ length: 100000 }, (_, i) => 'line ' + i).join('\n');
  assert.equal(normalizeText(long), long);
});
test('UTF-8 and BOM-tagged UTF-16 decode; binary comparison gives exact identity and offset', () => {
  assert.equal(decodeText(Buffer.from('你好 😀')), '你好 😀');
  assert.equal(decodeText(Buffer.concat([Buffer.from([255, 254]), Buffer.from('Hello', 'utf16le')])), 'Hello');
  assert.equal(decodeText(Buffer.from([254, 255, 0, 65])), 'A');
  assert.equal(decodeText(Buffer.from([0, 1, 255])), null);
  const pair = compareBuffers(Buffer.from([0, 1, 2]), Buffer.from([0, 1, 3]));
  assert.equal(pair.binary, true); assert.equal(pair.identical, false); assert.match(pair.left, /First differing byte: 2/);
  assert.match(pair.right, /00 01 03/);
  assert.equal(compareBuffers(Buffer.from([0, 255]), Buffer.from([0, 255])).identical, true);
});
test('NUL-delimited Git paths retain tabs and newlines and map additions/deletions/renames', () => {
  const files = parseChanges(Buffer.from('A\0new file.txt\0D\0old.txt\0R100\0a\tname.txt\0renamed\nfile.txt\0'));
  assert.deepEqual(files, [
    { status: 'A', leftPath: null, rightPath: 'new file.txt' },
    { status: 'D', leftPath: 'old.txt', rightPath: null },
    { status: 'R100', leftPath: 'a\tname.txt', rightPath: 'renamed\nfile.txt' }
  ]);
});
