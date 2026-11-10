import {VerifiedRemoteAbsence} from '../../data/sftp/core/fs/fileSystem';
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
  backupBatch(targets:MirrorTarget[],option:{concurrency?:number;message?:string;check?:()=>void;onCancellation?:(listener:()=>void)=>()=>void}={}) {
    const run=()=>this.backup(targets,option);
    const result=this.chain.then(run,run);this.chain=result.catch(()=>{});return result;
  }
  private async backup(targets:MirrorTarget[],option:{concurrency?:number;message?:string;check?:()=>void;onCancellation?:(listener:()=>void)=>()=>void}) {
    if (!targets.length) return;
    option.check?.();
    // Validate all paths before starting background filesystem work.
    const relatives=targets.map(target=>{
      const relative=path.normalize(target.relPath);
      if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||relative.split(path.sep).some(part=>part.toLowerCase()==='.git'))throw new Error('Unsafe mirror path');
      return relative;
    });
    let initialization:Promise<void>|undefined,preparationFailure:Error|undefined;
    let finishFiles:(()=>Promise<void>)|undefined;
    const prepareRepository=()=>{
      if(initialization)return;
      finishFiles=this.repository.beginFileBatch();
      initialization=this.repository.initialize();
      // Start private local ACL/Git initialization as soon as an original is
      // identified, overlapping remaining remote metadata on the one wire lane.
      initialization.catch(error=>{preparationFailure=error;});
    };
    let cancelled=false;const activeDownloads=new Set<TransferTask>();
    const removeCancellation=option.onCancellation?.(()=>{cancelled=true;for(const task of activeDownloads)task.cancel();});
    const check=()=>{option.check?.();if(cancelled)throw new Error('Transfer cancelled');};
    try {
      check();
      const inspected:Array<{target:MirrorTarget;relative:string;stat:any}|undefined>=new Array(targets.length);
      const concurrency=Math.max(1,Math.min(option.concurrency||1,targets.length));
      let next=0;
      // Bound metadata requests as well as downloads. All inspections must settle
      // successfully before downloading originals or allowing any upload.
      const inspections=await Promise.allSettled(Array.from({length:concurrency},async()=>{
      while(next<targets.length&&!preparationFailure&&!cancelled){
        const index=next++,target=targets[index];
        const relative=relatives[index];
        let stat;
        try{stat=await target.remoteFs.lstat(target.remotePath);}catch(error){
          if(error.code==='ENOENT'||error.code===2){
            if(error instanceof VerifiedRemoteAbsence)continue;
            if(target.remoteFs.supportsCompleteDirectoryListing!==false)continue;
            // Never RETR a path of unknown type: it could be a symlink.
            if(typeof (target.remoteFs as any).lstatForBackup!=='function')throw new Error('FTP cannot establish destination type or absence. Use SFTP.');
            try{stat=await (target.remoteFs as any).lstatForBackup(target.remotePath);}
            catch(probeError){if(probeError.code==='ENOENT'||probeError.code===2)continue;throw probeError;}
          }else throw new Error('Upload stopped: unable to inspect backup source '+target.relPath+'. '+error.message);
        }
        if(stat.type!==FileType.File&&stat.type!==FileType.SymbolicLink)throw new Error('Upload stopped: backup destination is not a regular file: '+target.relPath);
        inspected[index]={target,relative,stat};prepareRepository();
      }
      }));
      check();
      if(preparationFailure)throw preparationFailure;
      const inspectionFailure=inspections.find(result=>result.status==='rejected');
      if(inspectionFailure&&inspectionFailure.status==='rejected')throw inspectionFailure.reason;
      const originals=inspected.filter((item):item is {target:MirrorTarget;relative:string;stat:any}=>item!==undefined);
      if(!originals.length)return;
      await initialization;check();
      await this.repository.prepareFiles(originals.map(original=>original.relative));
      check();
      const queue=originals.slice(),touched=new Set<string>(),links=new Map<string,string>();
      let downloadFailure:Error|undefined;
      const count=Math.max(1,Math.min(option.concurrency||1,queue.length));
      const outcomes=await Promise.allSettled(Array.from({length:count},async()=>{
        while(queue.length&&!downloadFailure&&!cancelled) {
          const {target,relative,stat}=queue.shift()!;
          try {
            if(stat.type===FileType.SymbolicLink){
              links.set(relative.split(path.sep).join('/'),typeof stat.target==='string'?stat.target:await target.remoteFs.readlink(target.remotePath));
              continue;
            }
            const local=path.join(this.repoRoot,relative);
            await this.repository.files.ensureDir(path.dirname(local));
            check();
            const task=new TransferTask({fsPath:target.remotePath,fileSystem:target.remoteFs},{fsPath:local,fileSystem:this.repository.files},
              {fileType:FileType.File,transferDirection:TransferDirection.REMOTE_TO_LOCAL,transferOption:{fallbackMode:stat.mode,mtime:stat.mtime,atime:stat.atime,perserveTargetMode:true,overlapLocalPreparation:true}});
            activeDownloads.add(task);try{check();await task.run();}finally{activeDownloads.delete(task);}
            touched.add(relative.split(path.sep).join('/'));
          } catch(error) {downloadFailure=Object.assign(new Error('Upload stopped: unable to back up '+target.relPath+'. '+error.message+'. This destination was not overwritten.'),{code:error.code});throw downloadFailure;}
        }
      }));
      const failed=outcomes.find(result=>result.status==='rejected');
      if(failed&&failed.status==='rejected')throw failed.reason;
      check();
      if(!touched.size&&!links.size) return;
      await this.repository.add(touched);
      for(const [file,target] of links)await this.repository.stageLink(file,target);
      const matrix=await this.repository.status(touched);
      if(links.size||matrix.some(([,head,work,stage])=>head!==1||work!==1||stage!==1)){
        const oid=await this.repository.commit(option.message||`before upload ${new Date().toISOString()}`,{name:'vscode-sftp mirror',email:'sftp@localhost'});
        logger.info(`mirror: committed ${touched.size+links.size} file(s) (${oid.slice(0,7)})`);
      }
      await this.repository.verify(touched,links);
    } finally {
      // Never close a worker or return a failure while a background initializer
      // is still writing. Preserve the original failure after draining it.
      if(initialization)await Promise.allSettled([initialization]);
      try{await finishFiles?.();}finally{removeCancellation?.();}
    }
  }
}
const instances=new Map<string,MirrorService>();
export function getMirrorService(root:string) {
  const key=path.resolve(root);let service=instances.get(key);
  if(!service){service=new MirrorService(key);instances.set(key,service);}return service;
}
