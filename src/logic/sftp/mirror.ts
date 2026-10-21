// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as path from 'path';
import {MirrorRepository} from '../../data/sftp/mirror-repository';
import {FileSystem,FileType} from '../../data/sftp/core/fs';
import {logger} from '../../data/sftp/ports';
import TransferTask,{TransferDirection} from './core/transferTask';
export interface MirrorTarget {relPath:string;remotePath:string;remoteFs:FileSystem;}
export default class MirrorService {
  private chain: Promise<void> = Promise.resolve();
  private repository: MirrorRepository;
  constructor(readonly repoRoot:string) { this.repository=new MirrorRepository(repoRoot); }
  backupBatch(targets:MirrorTarget[],option:{concurrency?:number;message?:string}={}) {
    const run=()=>this.backup(targets,option);
    const result=this.chain.then(run,run);this.chain=result.catch(()=>{});return result;
  }
  private async backup(targets:MirrorTarget[],option:{concurrency?:number;message?:string}) {
    if (!targets.length) return;
    // New destinations have no original: avoid creating/scanning a Git backup
    // repository or applying Windows ACLs for files that do not exist yet.
    const originals:Array<{target:MirrorTarget;relative:string;stat:any}>=[];
    for(const target of targets){
      const relative=path.normalize(target.relPath);
      if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||relative.split(path.sep).some(part=>part.toLowerCase()==='.git'))throw new Error('Unsafe mirror path');
      let stat;
      try{stat=await target.remoteFs.lstat(target.remotePath);}catch(error){
        if(error.code==='ENOENT'||error.code===2){
          if(target.remoteFs.supportsCompleteDirectoryListing!==false)continue;
          // Never RETR a path of unknown type: it could be a symlink.
          if(typeof (target.remoteFs as any).lstatForBackup!=='function')throw new Error('FTP cannot establish destination type or absence. Use SFTP.');
          stat=await (target.remoteFs as any).lstatForBackup(target.remotePath);
        }else throw new Error('Upload stopped: unable to inspect backup source '+target.relPath+'. '+error.message);
      }
      if(stat.type!==FileType.File&&stat.type!==FileType.SymbolicLink)throw new Error('Upload stopped: backup destination is not a regular file: '+target.relPath);
      originals.push({target,relative,stat});
    }
    if(!originals.length)return;
    await this.repository.initialize();
    for(const original of originals)await this.repository.prepareFile(original.relative);
    const queue=originals.slice(),touched=new Set<string>(),links=new Map<string,string>();
    const count=Math.max(1,Math.min(option.concurrency||1,queue.length));
    const outcomes=await Promise.allSettled(Array.from({length:count},async()=>{
      while(queue.length) {
        const {target,relative,stat}=queue.shift()!;
        try {
          if(stat.type===FileType.SymbolicLink){
            links.set(relative.split(path.sep).join('/'),typeof stat.target==='string'?stat.target:await target.remoteFs.readlink(target.remotePath));
            continue;
          }
          const local=path.join(this.repoRoot,relative);
          await this.repository.files.ensureDir(path.dirname(local));
          await new TransferTask({fsPath:target.remotePath,fileSystem:target.remoteFs},{fsPath:local,fileSystem:this.repository.files},
            {fileType:FileType.File,transferDirection:TransferDirection.REMOTE_TO_LOCAL,transferOption:{fallbackMode:stat.mode,mtime:stat.mtime,atime:stat.atime,perserveTargetMode:true}}).run();
          touched.add(relative.split(path.sep).join('/'));
        } catch(error) {throw new Error('Upload stopped: unable to back up '+target.relPath+'. '+(target.remoteFs.supportsCompleteDirectoryListing===false?'FTP could not back up the identified destination. Check server read permissions or use SFTP for safely creating a new destination. ':'')+error.message);}
      }
    }));
    const failed=outcomes.find(result=>result.status==='rejected');
    if(failed&&failed.status==='rejected')throw failed.reason;
    if(!touched.size&&!links.size) return;
    for(const file of touched) await this.repository.add(file);
    for(const [file,target] of links)await this.repository.stageLink(file,target);
    const matrix=await this.repository.status(touched);
    if(links.size||matrix.some(([,head,work,stage])=>head!==1||work!==1||stage!==1)){
      const oid=await this.repository.commit(option.message||`before upload ${new Date().toISOString()}`,{name:'vscode-sftp mirror',email:'sftp@localhost'});
      logger.info(`mirror: committed ${touched.size+links.size} file(s) (${oid.slice(0,7)})`);
    }
    await this.repository.verify(touched,links);
  }
}
const instances=new Map<string,MirrorService>();
export function getMirrorService(root:string) {
  const key=path.resolve(root);let service=instances.get(key);
  if(!service){service=new MirrorService(key);instances.set(key,service);}return service;
}
