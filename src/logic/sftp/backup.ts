import * as path from 'path';
import { TransferTask, TransferDirection, FileType, FileSystem } from './core';
import { getMirrorService, MirrorTarget } from './mirror';
import { logger } from '../../data/sftp/ports';
// Show the "mirror failed" warning at most once per session — a failing backup
// must never block uploads, but the user should know the safety net is down.
let _mirrorWarned = false;
function warnMirrorOnce() {
  if (_mirrorWarned) {
    return;
  }
  _mirrorWarned = true;
  logger.warn('SFTP: git mirror backup failed — see the SFTP output channel. Uploads continue.');
}

// True when `child` is the same as or nested under `parent`.
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Snapshot the pre-overwrite remote content of every LOCAL_TO_REMOTE file into
 * the git mirror, BEFORE the scheduler runs the uploads. Best-effort: any error
 * is logged + surfaced once, never thrown.
 */
export async function backupBeforeUpload(
  ctx: any,
  tasks: TransferTask[],
  remoteFs: FileSystem
) {
  const mirror = ctx.config.mirror;
  if (!mirror || !mirror.enabled || !mirror.path) {
    return;
  }

  const repoRoot = mirror.path; // resolved to absolute in getCompleteConfig
  const base = ctx.fileService.baseDir;
  // Refuse a mirror folder inside the synced tree — it would be re-uploaded and
  // picked up by the watcher, creating a loop.
  if (isInside(repoRoot, base) || isInside(repoRoot, ctx.fileService.workspace)) {
    logger.error(
      `mirror: mirror.path (${repoRoot}) is inside the workspace; mirroring disabled to avoid an upload loop.`
    );
    return;
  }

  const targets: MirrorTarget[] = tasks
    .filter(t => t.transferType === TransferDirection.LOCAL_TO_REMOTE && t.fileType === FileType.File)
    .map(t => ({
      relPath: path.relative(base, t.localFsPath),
      remoteFs,
      remotePath: t.targetFsPath,
    }))
    // guard against paths outside the local base (defensive)
    .filter(target => target.relPath && !target.relPath.startsWith('..'));

  if (!targets.length) {
    return;
  }

  try {
    await getMirrorService(repoRoot).backupBatch(targets, {
      concurrency: ctx.config.concurrency,
    });
  } catch (err) {
    logger.error(err as Error, 'mirror backup failed');
    warnMirrorOnce();
  }
}
