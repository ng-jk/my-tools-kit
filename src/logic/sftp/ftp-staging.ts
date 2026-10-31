import {FTPFileSystem,FileType} from '../../data/sftp/core/fs';
import {FileStats} from '../../data/sftp/core/fs/fileSystem';

function ownerIdentity(stat:FileStats):string|undefined {
  if(Number.isSafeInteger(stat.uid)&&stat.uid>=0)return 'uid:'+stat.uid;
  if(typeof stat.owner!=='string'||!/^[A-Za-z0-9_.@-]+$/.test(stat.owner))return undefined;
  return /^\d+$/.test(stat.owner)?'uid:'+Number(stat.owner):'name:'+stat.owner;
}

function assertProtected(stat:FileStats,path:string):void {
  if(stat.type!==FileType.Directory||!Number.isInteger(stat.mode)||(stat.mode&0o022)!==0) {
    throw new Error('FTP private staging location is not protected: '+path+'. Configure ftpStagingPath to a private server directory outside shared upload folders. Destination ancestors also require protected ownership and permissions.');
  }
}

// FTP pathname-based STOR/chmod needs a separate protected staging namespace.
// The mutation policy independently protects destination ancestors.
export async function prepareFtpStaging(fs:FTPFileSystem,configured?:string):Promise<string> {
  const home=await fs.getLoginDirectory(),root=configured??home;
  if(!fs.pathResolver.isAbsolute(root)||/[\r\n\0]/.test(root))throw new Error('ftpStagingPath must be an absolute server directory');
  const read=fs.createStagingMetadataReader(),paths:string[]=[];
  let current=fs.pathResolver.normalize(root);
  while(true) {
    paths.push(current);
    const parent=fs.pathResolver.dirname(current);
    if(current==='/'||parent===current)break;
    current=parent;
  }
  paths.reverse();
  const namespace=await read(paths[0]);
  assertProtected(namespace,paths[0]);
  const owners=new Set(['uid:0','name:root',ownerIdentity(namespace)].filter(Boolean));
  // The authenticated server's initial home identifies the account namespace.
  // It need not be the selected upload destination or the staging override.
  let homeStat:FileStats|undefined;
  try {homeStat=await read(home);}catch{}
  if(homeStat?.type===FileType.Directory) {
    const owner=ownerIdentity(homeStat);
    if(owner)owners.add(owner);
  }
  for(const path of paths.slice(1)) {
    const stat=await read(path);
    assertProtected(stat,path);
    const owner=ownerIdentity(stat);
    if(!owner||!owners.has(owner))throw new Error('FTP private staging owner cannot be verified at '+path+'. Configure ftpStagingPath to the account private directory. Destination ancestors also require protected ownership and permissions.');
  }
  return fs.pathResolver.normalize(root);
}
