import {FileSystem,FileType} from '../../data/sftp/core/fs';
import * as operations from '../../data/sftp/core/fileBaseOperations';

// Configuration uses octal digits (755), not a JavaScript octal literal value.
export function serverCreationMode(value: number|string|undefined, label: string): number {
  if (value === undefined || value === null) return 0o755;
  if (!/^[0-7]{3,4}$/.test(String(value)) || parseInt(String(value),8)>0o777) throw new Error('Invalid '+label+': use octal digits such as 755, 700 or 600 (no special bits).');
  return parseInt(String(value),8);
}
export async function createServerDirectory(fs: FileSystem, path: string, configured?:number|string): Promise<void> {
  const mode=serverCreationMode(configured,'dirPerm'),missing:string[]=[];
  let current=path;
  while(true){
    let existing;
    try {existing=await fs.lstat(current);} catch(error) {if(error.code!=='ENOENT'&&error.code!==2)throw error;}
    if(existing){if(existing.type!==FileType.Directory)throw new Error('Destination is not a real directory: '+current);break;}
    missing.push(current);
    const parent=fs.pathResolver.dirname(current);
    if(parent===current)throw new Error('Server root is unavailable: '+current);
    current=parent;
  }
  if(missing.length>1 && (mode&0o300)!==0o300)throw new Error('Create missing parent folders with owner write/search permission first, then create the final read-only folder. No folders were created.');
  for(const target of missing.reverse()){
    // SFTP supplies the mode in MKDIR itself. FTP uses its server creation
    // policy. Never pathname-chmod a potentially replaced newly created entry.
    await fs.mkdir(target,mode);
    try {await fs.verifyDirectoryMode(target,mode);}
    catch(error){throw Object.assign(new Error('Directory creation did not finish. An entry may remain at '+target+'. No pathname chmod or cleanup was attempted. Check server creation permissions/umask; inspect and remove the retained entry only if safe before retrying, or choose another name. '+error.message),{code:'CREATE_DIRECTORY_INCOMPLETE',remotePath:target});}
  }
}
export async function createServerFile(fs:FileSystem,path:string,configured?:number|string):Promise<void>{
  await operations.createFile(path,fs,{mode:serverCreationMode(configured,'filePerm')});
}
