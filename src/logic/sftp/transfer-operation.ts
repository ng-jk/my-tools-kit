import {RemoteFileSystem} from '../../data/sftp/core/fs';
import {logger} from '../../data/sftp/ports';
import {createTransferConnections} from './transfer-connections';
import {connectionFailure} from './diagnostics';
import {assertRemoteParentDirectories, remoteParentDirectoryCache} from './parent-directories';
import {filesystemIdentity} from './core/staged-replacement';
import {transfer, sync} from './fileHandlers/transfer/transfer';
import * as path from 'path';
import {TransferDirection, FileType} from './core';
import {backupBeforeUpload} from './backup';
import {assertRemoteAncestors} from './remote-operations';
import {DirectoryPermissionScope} from './directory-permissions';
import {cancelPendingOperations} from './cancellation';
import {acquireUploadLock} from './upload-lock';

async function assertLocalAncestors(fs:any,target:string,root:string) {
  const base=path.resolve(root), relative=path.relative(base,path.resolve(target));
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)) throw new Error('Transfer escapes the configured local context');
  let current=base;
  for(const part of ['',...relative.split(path.sep).filter(Boolean).slice(0,-1)]) {
    if(part)current=path.join(current,part);
    let entry;
    try {entry=await fs.lstat(current);} catch(error) {if(error.code==='ENOENT'||error.code===2)return;throw error;}
    if(entry.type!==FileType.Directory)throw new Error('Local ancestor must be a real directory, not a symlink: '+current);
  }
}

const active = new Set<() => void>();
export function cancelActiveTransfers() { cancelPendingOperations(); for (const cancel of [...active]) cancel(); }

export function registerActiveTransfer(cancel: () => void) {
  active.add(cancel);
  return () => active.delete(cancel);
}

export async function executeTransfer(service: any, config: any, local: string, remote: string, down: boolean, options: any, synchronize = false, sources?: Array<{local: string; remote: string}>) {
  const checkCancelled = service.cancellationCheck();
  const releaseResources=service.retainTransferResources?.();
  const setupCancellation=new AbortController();
  const removeCancellationListener=service.onCancellation?.(()=>setupCancellation.abort());
  const cancel = () => {setupCancellation.abort();service.cancelTransferTasks();};
  const unregister = registerActiveTransfer(cancel);
  const directoryScope = new DirectoryPermissionScope();
  let scheduler: any;
  let connectionPool:Awaited<ReturnType<typeof createTransferConnections>>|undefined;
  let releaseUpload:(()=>void)|undefined;
  let finishMetadata: (()=>void)|undefined;
  let planning = true;
  const directoryTypes = new Map();
  const guard = (fs: any,identity=fs) => new Proxy(fs, {get(target, key) {
    if (key === filesystemIdentity) return identity;
    if (key === remoteParentDirectoryCache && target instanceof RemoteFileSystem) return directoryTypes;
    const value = Reflect.get(target, key);
    if (typeof value !== 'function') return value;
    if(key==='drainRead')return value.bind(target); // cleanup must survive cancellation
    return (...args: any[]) => { if (planning) checkCancelled(); return value.apply(target, args); };
  }});
  try {
    checkCancelled();
    if(!down)releaseUpload=await acquireUploadLock(config,sources ? config.remotePath : remote,checkCancelled);
    const remoteFs = guard(await service.getRemoteFileSystem(config));
    if(!down && remoteFs instanceof RemoteFileSystem)await assertRemoteParentDirectories(remoteFs,remote,true);
    finishMetadata=(remoteFs as any).beginMetadataReadScope?.();
    checkCancelled();
    await assertRemoteAncestors(remoteFs, remote, config.remotePath, true, true);
    checkCancelled();
    const localFs = guard(service.getLocalFileSystem());
    await assertLocalAncestors(localFs, local, service.baseDir);
    checkCancelled();

    const tasks: any[] = [];
    const pendingDeletions: Array<() => Promise<void>> = [];
    let deleted: unknown;
    for (const source of sources || [{local, remote}]) {
      checkCancelled();
      await assertLocalAncestors(localFs, source.local, service.baseDir);
      await assertRemoteAncestors(remoteFs, source.remote, config.remotePath, true, true);
      deleted = await (synchronize ? sync : transfer)({
        directoryScope, pendingDeletions,
        srcFsPath: down ? source.remote : source.local,
        targetFsPath: down ? source.local : source.remote,
        srcFs: down ? remoteFs : localFs, targetFs: down ? localFs : remoteFs,
        transferDirection: down ? TransferDirection.REMOTE_TO_LOCAL : TransferDirection.LOCAL_TO_REMOTE,
        transferOption: {...options, ftpStagingPath:config.ftpStagingPath},
        filePerm: config.filePerm, dirPerm: config.dirPerm,
      }, task => { checkCancelled(); tasks.push(task); });
    }
    checkCancelled();
    if (!down) await backupBeforeUpload({config, fileService: service}, tasks, remoteFs);
    checkCancelled();
    finishMetadata?.();finishMetadata=undefined;
    planning = false;
    const connections=!down&&config.protocol==='ftp'?Math.min(config.ftpConnections??1,tasks.length):1;
    if(connections>1 && typeof (remoteFs as any).createTransferConnection==='function'){
      logger.info('Preparing '+connections+' FTP upload connections.');
      try{connectionPool=await createTransferConnections(remoteFs,connections,setupCancellation.signal,checkCancelled);}
      catch(error){checkCancelled();const diagnosed=connectionFailure(error,config);if(diagnosed.securityFailure)throw diagnosed;const detail=diagnosed!==error?diagnosed.message:'The server rejected an additional session; check session limits and network access.';throw new Error('FTP parallel connection setup failed. Set ftpConnections to 1 if the server limits sessions. '+detail);}
      if(connectionPool.size<connections)logger.warn('FTP server accepted '+connectionPool.size+' of '+connections+' requested upload connections; continuing with the available connections.');
      const pool=connectionPool;
      for(const task of tasks)task.useConnectionPool(remoteFs,async()=>{
        const lease=await pool.acquire();return {...lease,fs:guard(lease.fs,(remoteFs as any)[filesystemIdentity])};
      });
    }
    // FTP commands/data remain serialized by each adapter's wire queue.
    // Permit bounded local preparation and completion work around that queue.
    scheduler = service.createTransferScheduler(connectionPool?.size||(config.protocol==='ftp'?(config.backgroundConcurrency??4):config.concurrency));
    tasks.forEach(task => scheduler.add(task));
    await scheduler.run();
    checkCancelled();
    planning = true;
    for (const remove of pendingDeletions) { checkCancelled(); await remove(); }
    checkCancelled();
    return {passed: true, transferred: tasks.length, deleted: deleted || []};
  } finally {
    removeCancellationListener?.();
    finishMetadata?.();
    directoryTypes.clear();
    scheduler?.stop();connectionPool?.close(); unregister();
    try{await directoryScope.finish();}finally{try{releaseUpload?.();}finally{releaseResources?.();}}
  }
}


// Both UI and CLI use this operation for an explicitly selected file batch.
export async function uploadBatch(service: any, config: any, files: string[], options: any = {}) {
  if (!files.length) return {passed: true, transferred: 0};
  const sources = [...new Set(files)].map(file => {
    const local = path.resolve(file);
    const relative = path.relative(service.baseDir, local);
    if (!relative || relative === '..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) {
      throw new Error('Batch upload source escapes the selected context: '+file);
    }
    return {local, remote:path.posix.join(config.remotePath, relative.split(path.sep).join('/'))};
  });
  return executeTransfer(service, config, sources[0].local, sources[0].remote, false, {
    ...options, expectedSourceType:'leaf', explicitUpload:false,
    ignore: Object.prototype.hasOwnProperty.call(options, "ignore") ? options.ignore : config.ignore, filePerm:config.filePerm, dirPerm:config.dirPerm,
    useTempFile:config.useTempFile, openSsh:config.openSsh,
  }, false, sources);
}
