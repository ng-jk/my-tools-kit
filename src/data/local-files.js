'use strict';
const fs = require('node:fs/promises');
async function readLocal(file, limit = 20 * 1024 * 1024) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('Choose a regular file.');
  if (stat.size > limit) throw new Error('File exceeds the 20 MiB limit.');
  return fs.readFile(file);
}
async function repositoryFolders(directory) {
  const path=require('node:path');
  const entries=await fs.readdir(directory,{withFileTypes:true});
  const candidates=[];
  // One directory level only; never recursively scan a whole drive or follow links.
  for(const entry of entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!e.name.startsWith('.')&&!['node_modules','vendor'].includes(e.name)).slice(0,200)) {
    const candidate=path.join(directory,entry.name);
    try {const stat=await fs.lstat(path.join(candidate,'.git'));if(stat.isFile()||stat.isDirectory())candidates.push(candidate);}
    catch(error){if(!['ENOENT','EACCES','EPERM'].includes(error.code))throw error;}
  }
  return candidates;
}
module.exports = { readLocal, repositoryFolders };
