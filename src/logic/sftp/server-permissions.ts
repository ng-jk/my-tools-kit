import {FileSystem,FileType} from '../../data/sftp/core/fs';
import * as operations from '../../data/sftp/core/fileBaseOperations';

// Configuration uses octal digits (755), not a JavaScript octal literal value.
export function serverCreationMode(value: number|string|undefined, label: string): number {
  if (value === undefined || value === null) return 0o755;
  if (!/^[0-7]{3,4}$/.test(String(value)) || parseInt(String(value),8)>0o777) throw new Error('Invalid '+label+': use octal digits such as 755, 700 or 600 (no special bits).');
  return parseInt(String(value),8);
}
export async function createServerDirectory(fs: FileSystem, path: string, configured?:number|string): Promise<void> {
  const mode=serverCreationMode(configured,'dirPerm');
  let existing;
  try {existing=await fs.lstat(path);} catch(error) {if(error.code!=='ENOENT'&&error.code!==2)throw error;}
  if(existing){if(existing.type!==FileType.Directory)throw new Error('Destination is not a real directory: '+path);return;}
  const parent=fs.pathResolver.dirname(path);
  if(parent!==path)await createServerDirectory(fs,parent,configured);
  await fs.mkdir(path);
  try {await fs.establishDirectoryMode(path,mode);}
  catch(error){await fs.rmdir(path,false).catch(()=>{});throw error;}
}
export async function createServerFile(fs:FileSystem,path:string,configured?:number|string):Promise<void>{
  await operations.createFile(path,fs,{mode:serverCreationMode(configured,'filePerm')});
}
