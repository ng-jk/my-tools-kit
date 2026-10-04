// Git I/O adapter shared by the VS Code and terminal interfaces.
import * as fs from 'fs';
import * as path from 'path';
import * as git from 'isomorphic-git';

export async function findGitRoot(filepath: string): Promise<string | null> {
  let current = path.resolve(filepath);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
export async function readLog(dir: string, depth: number) { return git.log({fs, dir, depth}); }
export async function readStatus(dir: string) { return git.statusMatrix({fs, dir}); }
export async function readCommitEntries(dir: string, revision: string) {
  const oid = /^[a-f0-9]{40}$/i.test(revision) ? revision : await git.resolveRef({fs, dir, ref: revision});
  const {commit} = await git.readCommit({fs, dir, oid});
  const parent = commit.parent[0];
  return git.walk({fs, dir, trees: parent ? [git.TREE({ref:oid}), git.TREE({ref:parent})] : [git.TREE({ref:oid})],
    map: async (filepath, entries) => {
      const [head, base] = entries;
      const headType = head ? await head.type() : undefined;
      const baseType = base ? await base.type() : undefined;
      return {filepath, headType, headOid: headType === 'blob' ? await head!.oid() : undefined,
        baseOid: baseType === 'blob' ? await base!.oid() : undefined};
    }});
}
