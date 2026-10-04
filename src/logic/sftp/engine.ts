import * as path from 'path';
import { FileService, FileType, TransferDirection, fileOperations } from './core';
import { transfer, sync } from './fileHandlers/transfer/transfer';
import { backupBeforeUpload } from './backup';
import { mergedDefault, validateConfig } from './config';
import { resolveProfileContext } from './core/profileContext';
import {removeRemotePath,renameRemotePath} from './remote-operations';
export { configurePorts } from '../../data/sftp/ports';
export { sshArguments } from './ssh-arguments';
export { watchPolicy } from './watch-policy';
export {getCommitChangedFiles, getUncommittedChangedFiles, getUncommittedTransfers} from './git-changes';
export {planGitTransfers, executeGitTransfers} from './git-transfer';
export {isOwnLocalChange, localEntryExists} from '../../data/sftp/local-events';
export {initialConfig, normalizeConfigurations} from './config';
export { verifyHostKey, fingerprint } from '../../data/sftp/host-keys';
export { FileService, FileType, TransferTask, TransferDirection, Scheduler } from './core';
export { transfer, sync } from './fileHandlers/transfer/transfer';
export { LocalFileSystem, SFTPFileSystem, FTPFileSystem } from '../../data/sftp/core/fs';
export { inspectConfig, createSession, operate };

function inspectConfig(raw: any, profile?: string) {
  const config = mergedDefault(raw);
  const selected = profile || config.defaultProfile || null;
  if (selected && !config.profiles?.[selected]) throw new Error('Unknown profile: ' + selected);
  return { config, selected, context: resolveProfileContext(config, selected) };
}
function createSession(workspace: string, raw: any, profile?: string) {
  const { config, selected, context } = inspectConfig(raw, profile);
  const base = path.resolve(workspace, context || '.');
  const service = new FileService(base, path.resolve(workspace), config);
  service.setConfigValidator(validateConfig);
  const resolved = service.getConfig(selected);
  return { service, config: resolved, profile: selected };
}
function resolveTarget(session: any, relative: string) {
  const normalized = path.posix.normalize(relative.replace(/\\/g, '/'));
  if (path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) throw new Error('Path must be relative to the configured context');
  return { local: path.resolve(session.service.baseDir, normalized), remote: path.posix.join(session.config.remotePath, normalized) };
}
async function operate(session: any, action: string, relative = '.', flags: any = {}) {
  const { service, config } = session;
  const { local, remote } = resolveTarget(session, relative);
  const remoteFs = await service.getRemoteFileSystem(config);
  const localFs = service.getLocalFileSystem();
  if (action === 'list') return remoteFs.list(remote);
  if (action === 'read') return (await remoteFs.readFile(remote)).toString('utf8');
  if (action === 'diff') return { local: (await localFs.readFile(local)).toString('utf8'), remote: (await remoteFs.readFile(remote)).toString('utf8') };
  if (action === 'mkdir') { await remoteFs.ensureDir(remote); return { passed: true }; }
  if (action === 'create') { await fileOperations.createFile(remote, remoteFs); return { passed: true }; }
  if (action === 'rename') {
    if (!flags.to || path.posix.resolve('/', remote) === path.posix.resolve('/', config.remotePath)) throw new Error('Rename requires a non-root path and --to');
    const destination = resolveTarget(session, flags.to).remote;
    if (path.posix.resolve('/', destination) === path.posix.resolve('/', config.remotePath)) throw new Error('Rename destination must be a non-root path');
    await renameRemotePath(remoteFs, remote, destination, config.remotePath); return { passed: true };
  }
  if (action === 'delete') {
    if (!flags.yes || path.posix.resolve('/', remote) === path.posix.resolve('/', config.remotePath)) throw new Error('Delete requires --yes and a non-root path');
    await removeRemotePath(remoteFs, remote, config.remotePath);
    return { passed: true };
  }
  if (!['upload','download','sync-up','sync-down','sync-both'].includes(action)) throw new Error('Unknown SFTP operation: ' + action);
  const down = action === 'download' || action === 'sync-down';
  const direction = down ? TransferDirection.REMOTE_TO_LOCAL : TransferDirection.LOCAL_TO_REMOTE;
  const options = { ...(action.startsWith('sync-') ? config.syncOption : {}),
    perserveTargetMode: !down && config.protocol === 'sftp' && !config.filePerm && !config.dirPerm,
    useTempFile: !down && config.useTempFile, openSsh: config.openSsh,
    ignore: flags.force ? null : config.ignore, bothDiretions: action === 'sync-both', filePerm: config.filePerm, dirPerm: config.dirPerm };
  if (options.delete && !flags.yes) throw new Error('syncOption.delete requires --yes');
  const tasks: any[] = [];
  const operation = action.startsWith('sync-') ? sync : transfer;
  const deleted = await operation({ srcFsPath: down ? remote : local, targetFsPath: down ? local : remote,
    srcFs: down ? remoteFs : localFs, targetFs: down ? localFs : remoteFs, transferDirection: direction,
    transferOption: options, filePerm: config.filePerm, dirPerm: config.dirPerm }, task => tasks.push(task));
  if (!down) await backupBeforeUpload({config, fileService: service}, tasks, remoteFs);
  const scheduler = service.createTransferScheduler(config.concurrency);
  tasks.forEach(task => scheduler.add(task));
  await scheduler.run();
  return { passed: true, transferred: tasks.length, deleted: deleted || [] };
}
