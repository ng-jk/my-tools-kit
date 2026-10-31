import {FileType, FileStats} from '../../data/sftp/core/fs/fileSystem';
export interface ParentDirectories {pathResolver:{dirname(path:string):string};lstat(path:string):Promise<FileStats>;createMutationMetadataReader?(): (path:string)=>Promise<FileStats>;}
// Ordinary metadata ports retain non-following type checks. Protocol adapters
// supply fresh ownership/mode evidence for namespace mutation protection.
export async function assertRemoteParentDirectories(fs:ParentDirectories,path:string,allowMissing=false):Promise<void>{
  if(fs.createMutationMetadataReader)return assertProtectedRemoteParents(fs,path,allowMissing);
  const parents:string[]=[];let current=fs.pathResolver.dirname(path);
  while(true){parents.push(current);const parent=fs.pathResolver.dirname(current);if(current==='/'||parent===current)break;current=parent;}
  for(const parent of parents.reverse()){
    let stat;
    try{stat=await fs.lstat(parent);}catch(error){if(allowMissing&&(error.code==='ENOENT'||error.code===2))continue;throw error;}
    if(stat.type!==FileType.Directory)throw new Error('Remote ancestor is not a real directory: '+parent+' (type '+(FileType[stat.type]||'Unknown')+').');
  }
}


export function isolationOwner(stat:FileStats):string|undefined {
  if(Number.isSafeInteger(stat.uid)&&stat.uid>=0)return 'uid:'+stat.uid;
  if(typeof stat.owner!=='string'||!/^[A-Za-z0-9_.@-]+$/.test(stat.owner))return undefined;
  if(/^\d+$/.test(stat.owner)){const uid=Number(stat.owner);return Number.isSafeInteger(uid)?'uid:'+uid:undefined;}
  return 'name:'+stat.owner;
}

export async function assertProtectedRemoteParents(fs:ParentDirectories,target:string,allowMissing=false):Promise<void> {
  if(!target.startsWith('/'))throw Object.assign(new Error('Remote isolation requires an absolute account-visible path. Set remotePath to the path visible inside the login namespace, for example /project; no server settings were changed.'),{code:'REMOTE_ISOLATION_REQUIRED',remotePath:target});
  const read=fs.createMutationMetadataReader?.()||((name:string)=>fs.lstat(name));
  const paths:string[]=[];let current=fs.pathResolver.dirname(target);
  while(true){paths.push(current);const parent=fs.pathResolver.dirname(current);if(current==='/'||parent===current)break;current=parent;}
  paths.reverse();
  const fail=(path:string,reason:string)=>Object.assign(new Error('Remote isolation check failed at '+path+': '+reason+'. No unsafe mutation was authorized. Use a dedicated account/project directory with protected ancestors; ask the hosting administrator if you cannot change the server. A jail alone does not protect folders from other writers inside it. Run SFTP: Check Server Isolation or devkit sftp isolation for details.'),{code:'REMOTE_ISOLATION_REQUIRED',remotePath:path});
  const check=(stat:FileStats,path:string)=>{
    if(stat.type!==FileType.Directory)throw fail(path,'not a real directory (possibly replaced by a symlink)');
    if(!Number.isInteger(stat.mode)||stat.mode<0||stat.mode>0o7777)throw fail(path,'directory permissions are unavailable');
    if((stat.mode&0o022)!==0)throw fail(path,'other accounts may replace directory entries (mode '+stat.mode.toString(8)+')');
    if(!isolationOwner(stat))throw fail(path,'directory ownership is unavailable');
  };
  const root=await read(paths[0]);check(root,paths[0]);
  const owners=new Set([isolationOwner(root)!,'uid:0','name:root']);
  let home:FileStats|undefined;try{home=await read('.');}catch{}
  if(home?.type===FileType.Directory&&isolationOwner(home)){
    if(!['uid:0','name:root'].includes(isolationOwner(root)!)&&isolationOwner(root)!==isolationOwner(home))throw fail(paths[0],'namespace root and login home ownership differ');
    owners.add(isolationOwner(home)!);
  }
  for(const path of paths.slice(1)){
    let stat:FileStats;try{stat=await read(path);}catch(error){if(allowMissing&&(error.code==='ENOENT'||error.code===2))continue;throw error;}
    check(stat,path);if(!owners.has(isolationOwner(stat)!))throw fail(path,'directory is owned by an account outside the login/admin trust boundary');
  }
}

export function isolationConnection(service:{workspace:string;baseDir:string;profile?:string|null},config:{host:string;port:number}) {
  return {host:config.host,port:config.port,workspace:service.workspace,context:service.baseDir,profile:service.profile??null};
}

export async function inspectServerIsolation(fs:ParentDirectories,root:string,connection?:ReturnType<typeof isolationConnection>) {
  try {
    await assertProtectedRemoteParents(fs,root.replace(/\/$/,'')+'/__devkit_isolation_probe__');
    return {passed:true,root,connection,namespace:'protected-metadata',jail:'not-verifiable-over-FTP-or-SFTP',message:'Existing ancestors have protected ownership and modes. No files were changed. The administrator must confirm the account jail, ACLs, mounts and other privileged writers; protocol metadata cannot prove these.'};
  }catch(error){return {passed:false,root,connection,namespace:'unsafe-or-unverifiable',jail:'not-verifiable-over-FTP-or-SFTP',code:error.code||'REMOTE_INSPECTION_FAILED',message:error.message};}
}
