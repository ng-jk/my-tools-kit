import {FileType, FileStats} from '../../data/sftp/core/fs/fileSystem';
export interface IsolationMetadata {pathResolver: {dirname(path:string):string}; parentIsolationStat(path:string):Promise<FileStats>;}
export async function assertIsolatedParents(fs: IsolationMetadata, path:string,allowMissing=false):Promise<void>{
    const paths:string[]=[];
    let current=fs.pathResolver.dirname(path);
    while(true){paths.push(current);const parent=fs.pathResolver.dirname(current);if(current==='/'||parent===current)break;current=parent;}
    paths.reverse();
    const root=await fs.parentIsolationStat(paths[0]);
    const owner=(stat:FileStats):string|undefined=>{
      if(Number.isSafeInteger(stat.uid)&&stat.uid!>=0)return 'uid:'+stat.uid;
      if(typeof stat.owner!=='string'||!/^[A-Za-z0-9_.@-]+$/.test(stat.owner))return;
      if(/^\d+$/.test(stat.owner)){const uid=Number(stat.owner);return Number.isSafeInteger(uid)?'uid:'+uid:undefined;}
      return 'name:'+stat.owner;
    };
    const safeMode=(stat:any,name:string)=>{
      if(stat.type!==FileType.Directory||!Number.isInteger(stat.mode)||(stat.mode&0o022)!==0)throw new Error('Remote ancestor is shared-writable or unverifiable: '+name+'. Upload stopped before mutations; use a non-shared server directory.');
      if(!owner(stat))throw new Error('Remote ancestor ownership is unverifiable: '+name+'. Upload stopped before mutations.');
    };
    safeMode(root,paths[0]);
    const rootOwner=owner(root)!;
    const owners=new Set<string>([rootOwner,'uid:0','name:root']);
    // The authenticated server's initial home is a trust anchor alongside its
    // namespace root. Require consistent ownership for virtual non-root jails.
    let home:any;
    try{home=await fs.parentIsolationStat('.');}catch{}
    if(home?.type===FileType.Directory && owner(home)){
      if(!['uid:0','name:root'].includes(rootOwner) && rootOwner!==owner(home))throw new Error('Remote namespace root and authenticated home have inconsistent ownership. Upload stopped before mutations.');
      owners.add(owner(home)!);
    }
    for(let i=1;i<paths.length;i++){
      let stat;
      try{stat=await fs.parentIsolationStat(paths[i]);}catch(error){if(allowMissing&&(error.code==='ENOENT'||error.code===2))continue;throw error;}
      safeMode(stat,paths[i]);
      if(!owners.has(owner(stat)!))throw new Error('Remote ancestor has an untrusted owner: '+paths[i]+'. Upload stopped before mutations; use a directory owned by the transfer account or server administrator.');
    }
  }

