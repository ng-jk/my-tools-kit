'use strict';
const fs = require('node:fs/promises');
async function readLocal(file, limit = 20 * 1024 * 1024) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('Choose a regular file.');
  if (stat.size > limit) throw new Error('File exceeds the 20 MiB limit.');
  return fs.readFile(file);
}
module.exports = { readLocal };
