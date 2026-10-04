// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as fs from 'fs';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as git from 'isomorphic-git';

/**
 * Git change inspection backed by the bundled isomorphic-git (no system `git` on
 * PATH required). Used by the "Upload File Changed" command to let the user pick
 * a commit (or the uncommitted working tree) and upload only the created/modified
 * files of that selection.
 *
 * All returned file paths are POSIX-style, relative to the git root `dir`.
 */

export interface CommitInfo {
  oid: string;
  /** First line of the commit message. */
  summary: string;
  /** Author timestamp in seconds. */
  timestamp: number;
}

/**
 * Find the git root containing `filepath` by walking up until a `.git` is found,
 * or null if not inside a repo. Deterministic across platforms (avoids
 * isomorphic-git findRoot's relative-path quirks).
 */
export async function findGitRoot(filepath: string): Promise<string | null> {
  let current = path.resolve(filepath);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await fse.pathExists(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null; // reached the filesystem root
    }
    current = parent;
  }
}

/** Recent commits, newest first. */
export async function listRecentCommits(dir: string, depth = 30): Promise<CommitInfo[]> {
  const log = await git.log({ fs, dir, depth });
  return log.map(entry => ({
    oid: entry.oid,
    summary: (entry.commit.message || '').split('\n')[0],
    timestamp: entry.commit.author.timestamp,
  }));
}

/**
 * Files created or modified in a commit, compared against its first parent.
 * Deletions are excluded (you cannot upload a removed file). A root commit
 * (no parent) yields all of its files as created.
 */
export async function getCommitChangedFiles(dir: string, oid: string): Promise<string[]> {
  const { commit } = await git.readCommit({ fs, dir, oid });
  const parentOid = commit.parent && commit.parent.length ? commit.parent[0] : null;

  const trees = parentOid
    ? [git.TREE({ ref: oid }), git.TREE({ ref: parentOid })]
    : [git.TREE({ ref: oid })];

  const results = await git.walk({
    fs,
    dir,
    trees,
    map: async (filepath: string, entries: any[]) => {
      if (filepath === '.') {
        return undefined;
      }
      const head = entries[0];
      const base = parentOid ? entries[1] : null;

      if (!head) {
        return undefined; // absent in the commit (deleted) -> skip
      }
      const headType = await head.type();
      if (headType !== 'blob') {
        return undefined; // directory: let walk recurse into it
      }
      if (!base) {
        return filepath; // created (root commit, or absent in parent)
      }
      const baseType = await base.type();
      const headOid = await head.oid();
      const baseOid = baseType === 'blob' ? await base.oid() : undefined;
      if (baseOid !== headOid) {
        return filepath; // modified (or type changed)
      }
      return undefined; // unchanged
    },
  });

  return (results as Array<string | undefined>).filter(
    (f): f is string => typeof f === 'string'
  );
}

/**
 * Files created or modified in the working tree relative to HEAD (staged or not).
 * Deletions are excluded.
 */
export async function getUncommittedChangedFiles(dir: string): Promise<string[]> {
  const matrix = await git.statusMatrix({ fs, dir });
  // Row: [filepath, HEAD, WORKDIR, STAGE].
  // WORKDIR === 2 means the working copy differs from HEAD (added or modified).
  // WORKDIR === 0 (absent / deleted) and === 1 (identical) are skipped.
  return matrix.filter(row => row[2] === 2).map(row => row[0] as string);
}
