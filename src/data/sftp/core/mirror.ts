// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as fs from 'fs';
import * as fse from 'fs-extra';
import * as path from 'path';
import { Readable } from 'stream';
import * as git from 'isomorphic-git';
import { logger } from '../ports';
import { FileSystem, FileType } from './fs/index';

/**
 * Git-mirror backup of remote files before they are overwritten by an upload.
 *
 * Flow (see design doc / plan-eng-review):
 *
 *   upload handle()
 *     ├─ collect tasks (no upload happens yet)
 *     ├─ MirrorService.backupBatch(targets)   ← download remote-CURRENT into the
 *     │     for each target (concurrency-limited):                mirror repo, then
 *     │        stream remoteFs.get(remotePath) ─▶ <repo>/<relPath>  ONE commit
 *     └─ scheduler.run()                        ← uploads start HERE
 *
 * Design decisions baked in:
 *  - before-only: we snapshot the pre-overwrite REMOTE content, not the local
 *    file (the local file is what the user already has).
 *  - always download, no mtime/size stat-skip: skipping would silently keep a
 *    stale backup in exactly the "someone hotfixed the server" case the feature
 *    exists for. We dedupe via git (statusMatrix) so identical content does not
 *    create an empty commit, but we never skip the read.
 *  - best-effort: every public method swallows its own errors. A failing backup
 *    must never block the actual upload. Callers still wrap in try/catch.
 *  - concurrent uploads are serialized through `_chain` so two batches can never
 *    interleave the git index.
 */

const AUTHOR = { name: 'vscode-sftp mirror', email: 'sftp@localhost' };

export interface MirrorTarget {
  /** Path inside the mirror repo, relative, POSIX-ish (forward slashes preferred). */
  relPath: string;
  remoteFs: FileSystem;
  /** Absolute path of the file on the remote. */
  remotePath: string;
}

interface BackupOption {
  concurrency?: number;
  /** Commit message; a timestamped default is used when omitted. */
  message?: string;
}

function pipeToFile(readable: Readable, absPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = fse.createWriteStream(absPath);
    readable.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', () => resolve());
    readable.pipe(ws);
  });
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = items.slice();
  const workerCount = Math.max(1, Math.min(limit || 1, queue.length || 1));
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(
      (async () => {
        while (queue.length) {
          const item = queue.shift() as T;
          await fn(item);
        }
      })()
    );
  }
  await Promise.all(workers);
}

// isomorphic-git wants POSIX-style relative paths regardless of platform.
function toGitPath(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

export default class MirrorService {
  private _repoRoot: string;
  // Serializes whole backup+commit units so concurrent uploads never touch the
  // git index at the same time. Errors are swallowed so one failure does not
  // poison the chain for later uploads.
  private _chain: Promise<void> = Promise.resolve();
  private _repoReady: Promise<void> | null = null;

  constructor(repoRoot: string) {
    this._repoRoot = repoRoot;
  }

  get repoRoot(): string {
    return this._repoRoot;
  }

  /** Create the repo directory + `git init` once (idempotent, memoized). */
  ensureRepo(): Promise<void> {
    if (!this._repoReady) {
      this._repoReady = (async () => {
        await fse.ensureDir(this._repoRoot);
        const gitDir = path.join(this._repoRoot, '.git');
        const exists = await fse.pathExists(gitDir);
        if (!exists) {
          await git.init({ fs, dir: this._repoRoot, defaultBranch: 'main' });
          logger.info(`mirror: initialized git repo at ${this._repoRoot}`);
        }
      })().catch(err => {
        // reset so a later call can retry
        this._repoReady = null;
        throw err;
      });
    }
    return this._repoReady;
  }

  /**
   * Download the current remote content of each target into the mirror repo and
   * make a single commit. Serialized against other backupBatch calls. Resolves
   * even on internal errors (best-effort), but rethrows so the caller can log;
   * callers are expected to wrap in try/catch and proceed with the upload.
   */
  backupBatch(targets: MirrorTarget[], option: BackupOption = {}): Promise<void> {
    const run = () => this._doBatch(targets, option);
    const result = this._chain.then(run, run);
    // keep the chain alive but isolated from this batch's failure
    this._chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async _doBatch(targets: MirrorTarget[], option: BackupOption): Promise<void> {
    if (!targets.length) {
      return;
    }

    await this.ensureRepo();

    const concurrency = option.concurrency && option.concurrency > 0 ? option.concurrency : 1;
    const touched: string[] = [];

    await runWithConcurrency(targets, concurrency, async target => {
      try {
        const stat = await target.remoteFs.lstat(target.remotePath);
        if (stat.type !== FileType.File) {
          return; // only back up regular files
        }
        const absPath = path.join(this._repoRoot, target.relPath);
        await fse.ensureDir(path.dirname(absPath));
        const stream = await target.remoteFs.get(target.remotePath);
        await pipeToFile(stream, absPath);
        touched.push(toGitPath(target.relPath));
      } catch (err) {
        // Remote file absent (nothing to back up) or a read error — skip it.
        logger.info(
          `mirror: skip ${target.relPath}: ${(err && (err as Error).message) || err}`
        );
      }
    });

    if (!touched.length) {
      return;
    }

    for (const filepath of touched) {
      await git.add({ fs, dir: this._repoRoot, filepath });
    }

    // Dedupe: only commit when at least one touched file actually changed.
    const touchedSet = new Set(touched);
    const matrix = await git.statusMatrix({
      fs,
      dir: this._repoRoot,
      filter: f => touchedSet.has(f),
    });
    // Row: [filepath, HeadStatus, WorkdirStatus, StageStatus].
    // Unchanged & committed === [_, 1, 1, 1].
    const changed = matrix.some(
      ([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1)
    );
    if (!changed) {
      logger.info('mirror: no remote changes to back up, skipping commit');
      return;
    }

    const message =
      option.message || `before upload ${new Date().toISOString()}`;
    const oid = await git.commit({
      fs,
      dir: this._repoRoot,
      message,
      author: AUTHOR,
    });
    logger.info(`mirror: committed ${touched.length} file(s) (${oid.slice(0, 7)})`);
  }
}

// One MirrorService per mirror repo root, so the serialization chain is shared
// across separate upload invocations targeting the same mirror folder.
const _instances = new Map<string, MirrorService>();

export function getMirrorService(repoRoot: string): MirrorService {
  let service = _instances.get(repoRoot);
  if (!service) {
    service = new MirrorService(repoRoot);
    _instances.set(repoRoot, service);
  }
  return service;
}
