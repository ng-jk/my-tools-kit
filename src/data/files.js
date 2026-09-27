'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function inside(root, relative) {
  root = fs.realpathSync(root);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Path escapes project root');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink paths are not supported: ' + relative);
  }
  return target;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function hash(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
module.exports = { inside, readJson, hash, writeAtomic };

module.exports.readBuffer = file => fs.readFileSync(file);
