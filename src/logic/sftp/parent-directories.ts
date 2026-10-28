import {FileType, FileStats} from '../../data/sftp/core/fs/fileSystem';
export interface ParentDirectories {pathResolver:{dirname(path:string):string};lstat(path:string):Promise<FileStats>;}
// Requested compatibility policy: the server enforces write permissions.
// Existing ancestor modes, owners and missing Unix permission facts do not
// authorize or block an upload. Retain ordinary non-following path validation.
export async function assertRemoteParentDirectories(fs:ParentDirectories,path:string,allowMissing=false):Promise<void>{
  const parents:string[]=[];let current=fs.pathResolver.dirname(path);
  while(true){parents.push(current);const parent=fs.pathResolver.dirname(current);if(current==='/'||parent===current)break;current=parent;}
  for(const parent of parents.reverse()){
    let stat;
    try{stat=await fs.lstat(parent);}catch(error){if(allowMissing&&(error.code==='ENOENT'||error.code===2))continue;throw error;}
    if(stat.type!==FileType.Directory)throw new Error('Remote ancestor is not a real directory: '+parent+' (type '+(FileType[stat.type]||'Unknown')+').');
  }
}
