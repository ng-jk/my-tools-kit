import {filesystemIdentity} from './core/staged-replacement';
import {transfer, sync} from './fileHandlers/transfer/transfer';
import * as path from 'path';
import {TransferDirection, FileType} from './core';
import {backupBeforeUpload} from './backup';
import {assertRemoteAncestors} from './remote-operations';
import {DirectoryPermissionScope} from './directory-permissions';

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
export function cancelActiveTransfers() { for (const cancel of [...active]) cancel(); }

export async function executeTransfer(service: any, config: any, local: string, remote: string, down: boolean, options: any, synchronize = false) {
  const checkCancelled = service.cancellationCheck();
  const cancel = () => service.cancelTransferTasks();
  active.add(cancel);
  const directoryScope = new DirectoryPermissionScope();
  let scheduler: any;
  let planning = true;
  const guard = (fs: any) => new Proxy(fs, {get(target, key) {
    if (key === filesystemIdentity) return target;
    const value = Reflect.get(target, key);
    if (typeof value !== 'function') return value;
    return (...args: any[]) => { if (planning) checkCancelled(); return value.apply(target, args); };
  }});
  try {
    checkCancelled();
    const remoteFs = guard(await service.getRemoteFileSystem(config));
    checkCancelled();
    await assertRemoteAncestors(remoteFs, remote, config.remotePath, true, true);
    checkCancelled();
    const localFs = guard(service.getLocalFileSystem());
    await assertLocalAncestors(localFs, local, service.baseDir);
    checkCancelled();
    scheduler = service.createTransferScheduler(config.concurrency);
    const tasks: any[] = [];
    const pendingDeletions: Array<() => Promise<void>> = [];
    const deleted = await (synchronize ? sync : transfer)({
      directoryScope, pendingDeletions,
      srcFsPath: down ? remote : local, targetFsPath: down ? local : remote,
      srcFs: down ? remoteFs : localFs, targetFs: down ? localFs : remoteFs,
      transferDirection: down ? TransferDirection.REMOTE_TO_LOCAL : TransferDirection.LOCAL_TO_REMOTE,
      transferOption: options, filePerm: config.filePerm, dirPerm: config.dirPerm,
    }, task => { checkCancelled(); tasks.push(task); });
    checkCancelled();
    if (!down) await backupBeforeUpload({config, fileService: service}, tasks, remoteFs);
    checkCancelled();
    planning = false;
    tasks.forEach(task => scheduler.add(task));
    await scheduler.run();
    checkCancelled();
    planning = true;
    for (const remove of pendingDeletions) { checkCancelled(); await remove(); }
    checkCancelled();
    return {passed: true, transferred: tasks.length, deleted: deleted || []};
  } finally {
    scheduler?.stop(); active.delete(cancel);
    await directoryScope.finish();
  }
}
