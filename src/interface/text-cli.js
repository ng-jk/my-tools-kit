'use strict';
const { readBuffer, writeAtomic } = require('../data/files');
const { readLocal } = require('../data/local-files');
const { formatJson, normalizeText } = require('../logic/text-tools');
const git = require('../logic/git-compare');
async function main(args) {
  const [command, ...values] = args;
  if (command === 'json') {
    const file = values.shift();
    if (!file) throw new Error('json requires a file (use - for pasted text on stdin)');
    let output, minify = false, validate = false, indent;
    while (values.length) {
      const option = values.shift();
      if (option === '--minify') minify = true;
      else if (option === '--validate') validate = true;
      else if (option === '--indent' && values.length) { const value = values.shift(); if (!['2', '4', 'tab'].includes(value)) throw new Error('Indent must be 2, 4, or tab'); indent = value === 'tab' ? 'tab' : Number(value); }
      else if (option === '--out' && values.length) output = values.shift();
      else throw new Error('Unknown JSON option: ' + option);
    }
    const result = formatJson(readBuffer(file === '-' ? 0 : file).toString('utf8'), { minify, indent });
    if (validate) { console.log(JSON.stringify({ passed: true, valid: true })); return { passed: true }; }
    if (output) writeAtomic(output, result + '\n'); else console.log(result);
    return { passed: true };
  }
  let left, right, options = {};
  if (command === 'compare') {
    const [a, b, ...flags] = values;
    if (!a || !b) throw new Error('compare requires two files; use - - for a JSON stdin object with left/right pasted text');
    for (const flag of flags) {
      const name = { '--json': 'json', '--ignore-case': 'ignoreCase', '--trim-whitespace': 'trimWhitespace', '--line-endings': 'lineEndings' }[flag];
      if (!name) throw new Error('Unknown comparison option: ' + flag);
      options[name] = true;
    }
    if (a === '-' && b === '-') {
      const input = JSON.parse(readBuffer(0).toString('utf8'));
      if (typeof input.left !== 'string' || typeof input.right !== 'string') throw new Error('stdin requires left and right strings');
      left = Buffer.from(input.left); right = Buffer.from(input.right);
    } else { left = await readLocal(a); right = await readLocal(b); }
  } else if (command === 'git-changes') {
    if (values.length !== 3) throw new Error('git-changes requires root, base, target');
    const result = await git.changes(...values); console.log(JSON.stringify(result, null, 2)); return result;
  } else if (command === 'git-compare') {
    if (values.length < 4 || values.length > 5) throw new Error('git-compare requires root, base, target, left-path and optional right-path');
    const [root, base, target, a, b = a] = values;
    left = (await git.readFile(root, base, a === '-' ? null : a)).buffer;
    right = (await git.readFile(root, target, b === '-' ? null : b)).buffer;
  } else throw new Error('Unknown text command');
  const comparison = git.compareBuffers(left, right);
  if (!comparison.binary) {
    comparison.left = normalizeText(comparison.left, options);
    comparison.right = normalizeText(comparison.right, options);
    comparison.identical = comparison.left === comparison.right;
  }
  console.log(JSON.stringify({ passed: true, ...comparison }, null, 2));
  process.exitCode = comparison.identical ? 0 : 1;
  return comparison;
}
module.exports = { main };
