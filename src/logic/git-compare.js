'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { inside } = require('../data/files');
const { git } = require('../data/git');
const { readLocal } = require('../data/local-files');
const { MAX_TEXT, decodeText } = require('./text-tools');

async function repository(directory) { return (await git(directory, ['rev-parse', '--show-toplevel'])).toString('utf8').trim(); }
async function resolveRevision(root, revision) {
  if (typeof revision !== 'string' || !revision || revision.length > 512 || /[\0\r\n]/.test(revision)) throw new Error('Enter a commit, tag, or branch.');
  if (revision === 'WORKTREE' || revision === 'INDEX') return revision;
  const sha = (await git(root, ['rev-parse', '--verify', '--end-of-options', revision + '^{commit}'])).toString().trim();
  if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Revision did not resolve to a commit.');
  return sha;
}
async function history(root) {
  // Check HEAD first: an empty repository has no history but remains a useful error state.
  await resolveRevision(root, 'HEAD');
  const parts = (await git(root, ['log', '-60', '--format=%H%x00%s%x00'])).toString('utf8').split('\0');
  const commits = [];
  for (let i = 0; i + 1 < parts.length; i += 2) commits.push({ sha: parts[i].trim(), subject: parts[i + 1] });
  return commits;
}
function filePath(file) {
  if (typeof file !== 'string' || !file || file.includes('\0') || file.includes('\\') || file.startsWith('/') || /^[a-z]:/i.test(file) || file.split('/').some(p => p === '..' || p === '.')) throw new Error('Use a repository-relative path with forward slashes.');
  return file;
}
function parseChanges(buffer) {
  const parts = buffer.toString('utf8').split('\0'); const changes = [];
  for (let i = 0; i < parts.length && parts[i];) {
    const status = parts[i++], first = parts[i++];
    if (!first) throw new Error('Invalid Git change list');
    const renamed = /^[RC]/.test(status); const second = renamed ? parts[i++] : first;
    if (!second) throw new Error('Invalid Git rename record');
    changes.push({ status, leftPath: status === 'A' ? null : first, rightPath: status === 'D' ? null : second });
  }
  return changes;
}
async function changes(root, base, target) {
  const left = await resolveRevision(root, base), right = await resolveRevision(root, target);
  if (left === 'WORKTREE' || left === 'INDEX') throw new Error('The left revision must be a commit, branch, or tag.');
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames'];
  if (right === 'INDEX') args.push('--cached', left);
  else if (right === 'WORKTREE') args.push(left);
  else args.push(left, right);
  args.push('--');
  const files = parseChanges(await git(root, args));
  if (right === 'WORKTREE') for (const file of (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).toString().split('\0').filter(Boolean)) files.push({ status: '?', leftPath: null, rightPath: file });
  return { root, left, right, files };
}
async function listFiles(root, revision) {
  const resolved = await resolveRevision(root, revision);
  if (resolved === 'WORKTREE') return [...new Set((await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).toString().split('\0').filter(Boolean))];
  if (resolved === 'INDEX') return (await git(root, ['ls-files', '-z'])).toString().split('\0').filter(Boolean);
  return (await git(root, ['ls-tree', '-r', '--name-only', '-z', resolved])).toString().split('\0').filter(Boolean);
}
async function readFile(root, revision, file) {
  if (file === null) return { exists: false, buffer: Buffer.alloc(0) };
  filePath(file);
  const resolved = await resolveRevision(root, revision);
  if (resolved === 'WORKTREE') {
    const absolute = inside(root, file);
    try {
      return { exists: true, buffer: await readLocal(absolute, MAX_TEXT) };
    } catch (e) { if (e.code === 'ENOENT') return { exists: false, buffer: Buffer.alloc(0) }; throw e; }
  }
  let oid;
  if (resolved === 'INDEX') {
    const entries = (await git(root, ['ls-files', '--stage', '-z', '--', file])).toString().split('\0').filter(Boolean);
    const matched = entries.filter(e => e.slice(e.indexOf('\t') + 1) === file);
    if (matched.length > 1 || matched[0] && matched[0].split('\t')[0].split(' ')[2] !== '0') throw new Error('This file has unresolved merge stages. Resolve it before comparing the index.');
    oid = matched[0]?.split(' ')[1];
  } else {
    const entries = (await git(root, ['ls-tree', '-z', resolved, '--', file])).toString().split('\0').filter(Boolean);
    const entry = entries.find(e => e.slice(e.indexOf('\t') + 1) === file);
    if (entry && entry.split(' ')[1] !== 'blob') throw new Error('Select a regular file, not a directory or submodule.');
    oid = entry?.split(' ')[2].split('\t')[0];
  }
  if (!oid) return { exists: false, buffer: Buffer.alloc(0) };
  const size = Number((await git(root, ['cat-file', '-s', oid])).toString());
  if (size > MAX_TEXT) throw new Error('Git file exceeds the 20 MiB limit.');
  return { exists: true, buffer: await git(root, ['cat-file', 'blob', oid]) };
}
function compareBuffers(left, right) {
  const l = decodeText(left), r = decodeText(right);
  if (l !== null && r !== null) return { left: l, right: r, binary: false, identical: left.equals(right) };
  let offset = 0;
  while (offset < Math.min(left.length, right.length) && left[offset] === right[offset]) offset++;
  const identical = left.equals(right), start = Math.max(0, offset - 32);
  function summary(buffer) {
    const lines = ['Binary / non-UTF text comparison', `Size: ${buffer.length} bytes`, `SHA-256: ${crypto.createHash('sha256').update(buffer).digest('hex')}`, identical ? 'Files are byte-for-byte identical.' : `First differing byte: ${offset} (0x${offset.toString(16)})`, '', 'Hex excerpt around the first difference (not a full binary diff):'];
    for (let i = start; i < Math.min(buffer.length, start + 192); i += 16) lines.push(i.toString(16).padStart(8, '0') + '  ' + [...buffer.subarray(i, i + 16)].map(v => v.toString(16).padStart(2, '0')).join(' '));
    return lines.join('\n');
  }
  return { left: summary(left), right: summary(right), binary: true, identical };
}
module.exports = { repository, resolveRevision, history, changes, listFiles, readFile, parseChanges, compareBuffers };
