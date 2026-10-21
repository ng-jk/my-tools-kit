import * as path from 'path';
import { TransferTask, TransferDirection, FileType, FileSystem } from './core';
import { getMirrorService, MirrorTarget } from './mirror';
import { logger } from '../../data/sftp/ports';
import {defaultBackupPath} from '../../data/sftp/backup-location';
// True when `child` is the same as or nested under `parent`.
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel!=='..' && !rel.startsWith('..'+path.sep) && !path.isAbsolute(rel));
}

/** Save remote originals before upload. A failed backup must stop replacement. */
export async function backupBeforeUpload(
  ctx: any,
  tasks: TransferTask[],
  remoteFs: FileSystem
) {
  const mirror = ctx.config.mirror;
  const repoRoot = mirror?.enabled && mirror.path ? mirror.path : defaultBackupPath(ctx.fileService.workspace,ctx.fileService.baseDir,ctx.config,ctx.fileService.profile);
  const base = ctx.fileService.baseDir;
  // Refuse a mirror folder inside the synced tree — it would be re-uploaded and
  // picked up by the watcher, creating a loop.
  if (isInside(repoRoot, base) || isInside(repoRoot, ctx.fileService.workspace)) {
    throw new Error('Backup directory must be outside the workspace and upload context: '+repoRoot);
  }

  const targets: MirrorTarget[] = tasks
    .filter(t => t.transferType === TransferDirection.LOCAL_TO_REMOTE && (t.fileType === FileType.File || t.fileType === FileType.SymbolicLink))
    .map(t => ({
      relPath: path.relative(base, t.localFsPath),
      remoteFs,
      remotePath: t.targetFsPath,
    }));
  for(const target of targets)if(!target.relPath||target.relPath==='..'||target.relPath.startsWith('..'+path.sep)||path.isAbsolute(target.relPath))throw new Error('Backup source escapes the configured local context');

  if (!targets.length) {
    return;
  }

  await getMirrorService(repoRoot).backupBatch(targets, {
    concurrency: ctx.config.concurrency,
  });
  logger.info('Upload backup saved in '+repoRoot);
}
