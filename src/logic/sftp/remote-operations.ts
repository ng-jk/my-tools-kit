import * as path from 'path';
import {checkedEntries} from '../../data/sftp/path-safety';
import {FileSystem,FileType} from '../../data/sftp/core/fs';
export function assertRemoteChild(target:string,root:string) {
  const base=path.posix.resolve('/',root.replace(/\\/g,'/')),value=path.posix.resolve('/',target.replace(/\\/g,'/'));
  const relative=path.posix.relative(base,value);
  if(!relative||relative==='..'||relative.startsWith('../')||path.posix.isAbsolute(relative)) throw new Error('Operation requires a non-root path inside the configured remote root');
}
export async function assertRemoteAncestors(fs:FileSystem,target:string,root:string,allowRoot=false,allowMissing=false) {
  const same=path.posix.resolve('/',target.replace(/\\/g,'/'))===path.posix.resolve('/',root.replace(/\\/g,'/'));
  if(!allowRoot || !same)assertRemoteChild(target,root);
  const base=path.posix.normalize(root.replace(/\\/g,'/'));
  const relative=path.posix.relative(base,path.posix.normalize(target.replace(/\\/g,'/')));
  const parents=relative.split('/').slice(0,-1);
  let current=base;
  for (const component of ['',...parents]) {
    if(component)current=path.posix.join(current,component);
    let entry;
    try {entry=await fs.lstat(current);}
    catch(error) {if(allowMissing && (error.code==='ENOENT'||error.code===2))return;throw error;}
    if(entry.type!==FileType.Directory) throw new Error('Remote ancestor must be a real directory, not a symlink: '+current);
  }
}
export async function removeRemotePath(fs:FileSystem,target:string,root:string,skipDir=false,ignore?: (path:string, side?: 'local' | 'remote')=>boolean) {
  assertRemoteChild(target,root);
  if(ignore?.(target, 'remote')) return;
  await assertRemoteAncestors(fs,target,root);
  const stat=await fs.lstat(target);
  if(stat.type===FileType.Directory) {
    if(skipDir) return;
    for(const entry of checkedEntries(fs,target,await fs.list(target))) await removeRemotePath(fs,entry.fspath,root,false,ignore);
    if((await fs.list(target)).length) return;
    await fs.rmdir(target,false);
  }
  else if(stat.type===FileType.File||stat.type===FileType.SymbolicLink)await fs.unlink(target);
  else throw new Error('Unsupported remote file type');
}
export async function renameRemotePath(fs:FileSystem,from:string,to:string,root:string) {
  await assertRemoteAncestors(fs,from,root);await assertRemoteAncestors(fs,to,root);await fs.rename(from,to);
}
