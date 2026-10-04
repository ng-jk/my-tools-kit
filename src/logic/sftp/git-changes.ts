import {findGitRoot, readLog, readStatus, readCommitEntries} from '../../data/sftp/git-repository';
export {findGitRoot};
export async function listRecentCommits(dir: string, depth = 30) {
  return (await readLog(dir, depth)).map(entry => ({oid:entry.oid,
    summary:(entry.commit.message || '').split('\n')[0], timestamp:entry.commit.author.timestamp}));
}
export async function getCommitChangedFiles(dir: string, revision: string): Promise<string[]> {
  const entries = await readCommitEntries(dir, revision);
  return entries.filter(entry => entry && entry.headType === 'blob' && entry.headOid !== entry.baseOid).map(entry => entry.filepath);
}
export async function getUncommittedChangedFiles(dir: string): Promise<string[]> {
  return (await readStatus(dir)).filter(row => row[2] === 2).map(row => row[0]);
}
export async function getUncommittedTransfers(dir: string) {
  return (await readStatus(dir)).filter(row => row[2] === 2 || (row[1] !== 0 && row[2] === 0))
    .map(row => ({kind: row[2] === 0 ? 'delete' as const : 'upload' as const, path:row[0]}));
}
