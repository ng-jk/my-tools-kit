import * as path from 'path';
import {checkedEntries} from '../../data/sftp/path-safety';
import {FileSystem,FileType} from '../../data/sftp/core/fs';
export function assertRemoteChild(target:string,root:string) {
  const base=path.posix.resolve('/',root.replace(/\\/g,'/')),value=path.posix.resolve('/',target.replace(/\\/g,'/'));
  const relative=path.posix.relative(base,value);
  if(!relative||relative==='..'||relative.startsWith('../')||path.posix.isAbsolute(relative)) throw new Error('Operation requires a non-root path inside the configured remote root');
}
export async function removeRemotePath(fs:FileSystem,target:string,root:string,skipDir=false,ignore?: (path:string)=>boolean) {
  assertRemoteChild(target,root);
  if(ignore?.(target)) return;
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
  assertRemoteChild(from,root);assertRemoteChild(to,root);await fs.rename(from,to);
}
