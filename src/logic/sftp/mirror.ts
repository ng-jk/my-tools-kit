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
    await this.repository.initialize();
    const queue=targets.slice(),touched=new Set<string>();
    const count=Math.max(1,Math.min(option.concurrency||1,queue.length));
    await Promise.all(Array.from({length:count},async()=>{
      while(queue.length) {
        const target=queue.shift()!;
        try {
          const relative=path.normalize(target.relPath);
          if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||relative.split(path.sep).includes('.git')) throw new Error('Unsafe mirror path');
          const stat=await target.remoteFs.lstat(target.remotePath);
          if(stat.type!==FileType.File) continue;
          const local=path.join(this.repoRoot,relative);
          await this.repository.files.ensureDir(path.dirname(local));
          await new TransferTask({fsPath:target.remotePath,fileSystem:target.remoteFs},{fsPath:local,fileSystem:this.repository.files},
            {fileType:FileType.File,transferDirection:TransferDirection.REMOTE_TO_LOCAL,transferOption:{fallbackMode:stat.mode,mtime:stat.mtime,atime:stat.atime,perserveTargetMode:true}}).run();
          touched.add(relative.split(path.sep).join('/'));
        } catch(error) {logger.warn(`mirror: skip ${target.relPath}: ${error.message}`);}
      }
    }));
    if(!touched.size) return;
    for(const file of touched) await this.repository.add(file);
    const matrix=await this.repository.status(touched);
    if(!matrix.some(([,head,work,stage])=>head!==1||work!==1||stage!==1)) return;
    const oid=await this.repository.commit(option.message||`before upload ${new Date().toISOString()}`,{name:'vscode-sftp mirror',email:'sftp@localhost'});
    logger.info(`mirror: committed ${touched.size} file(s) (${oid.slice(0,7)})`);
  }
}
const instances=new Map<string,MirrorService>();
export function getMirrorService(root:string) {
  const key=path.resolve(root);let service=instances.get(key);
  if(!service){service=new MirrorService(key);instances.set(key,service);}return service;
}
