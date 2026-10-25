import {FileSystem,FileType} from '../../data/sftp/core/fs';
import * as operations from '../../data/sftp/core/fileBaseOperations';

// Configuration uses octal digits (755), not a JavaScript octal literal value.
export function serverCreationMode(value: number|string|undefined, label: string): number {
  if (value === undefined || value === null) return 0o755;
  if (!/^[0-7]{3,4}$/.test(String(value)) || parseInt(String(value),8)>0o777) throw new Error('Invalid '+label+': use octal digits such as 755, 700 or 600 (no special bits).');
  return parseInt(String(value),8);
}
export async function createServerDirectory(fs: FileSystem, path: string, configured?:number|string): Promise<void> {
  const mode=serverCreationMode(configured,'dirPerm'),created:string[]=[];
  async function create(target:string):Promise<void>{
    let existing;
    try {existing=await fs.lstat(target);} catch(error) {if(error.code!=='ENOENT'&&error.code!==2)throw error;}
    if(existing){if(existing.type!==FileType.Directory)throw new Error('Destination is not a real directory: '+target);return;}
    const parent=fs.pathResolver.dirname(target);
    if(parent!==target)await create(parent);
    await fs.mkdir(target);
    try {await fs.establishDirectoryMode(target,mode|0o300);}
    catch(error){await fs.rmdir(target,false).catch(()=>{});throw error;}
    created.push(target);
  }
  try {await create(path);}
  finally {
    // Populate new parents before restoring an explicitly read-only final mode.
    // Existing ancestors are never chmod'ed by this creation command.
    if((mode|0o300)!==mode){
      const errors=[];
      for(const target of created.reverse())try{await fs.establishDirectoryMode(target,mode);}catch(error){errors.push(error);}
      if(errors.length)throw errors[0];
    }
  }
}
export async function createServerFile(fs:FileSystem,path:string,configured?:number|string):Promise<void>{
  await operations.createFile(path,fs,{mode:serverCreationMode(configured,'filePerm')});
}
