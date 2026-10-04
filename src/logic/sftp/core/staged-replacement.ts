import {randomUUID} from 'crypto';
import {FileSystem, FileType} from '../../../data/sftp/core/fs';
export function stagingPath(target: string) { return target + '.devkit-' + randomUUID(); }
export function isTransferArtifact(value: string) { return /\.devkit-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.backup)?$/i.test(value); }
export const filesystemIdentity = Symbol("filesystemIdentity");
const locks = new WeakMap<FileSystem, Map<string, Promise<void>>>();
export async function replaceStaged(fs: FileSystem, staged: string, target: string, atomic = false, checkCancelled: () => void = () => {}) {
  const identity = (fs as any)[filesystemIdentity] || fs;
  let targets = locks.get(identity);
  if (!targets) { targets = new Map(); locks.set(identity, targets); }
  const key = fs.pathIdentity ? fs.pathIdentity(target) : target;
  const previous = targets.get(key) || Promise.resolve();
  let release: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  targets.set(key, current);
  await previous;
  try { checkCancelled(); await replace(fs, staged, target, atomic, checkCancelled); }
  finally { release!(); if (targets.get(key) === current) targets.delete(key); }
}
async function replace(fs: FileSystem, staged: string, target: string, atomic: boolean, checkCancelled: () => void) {
  checkCancelled();
  if (atomic) { await fs.renameAtomic(staged, target); return; }
  let existing;
  try { existing = await fs.lstat(target); }
  catch (error) { if (error.code !== 'ENOENT' && error.code !== 2) throw error; }
  checkCancelled();
  if (!existing) { await fs.rename(staged, target); return; }
  if (existing.type === FileType.Directory) throw new Error('Refusing to replace a directory with a file');
  const backup = stagingPath(target) + '.backup';
  await fs.rename(target, backup);
  try { await fs.rename(staged, target); }
  catch (error) {
    try { await fs.rename(backup, target); }
    catch (restoreError) { throw new Error(`Replacement failed; original retained at ${backup}. Restore failed: ${restoreError.message}. Transfer error: ${error.message}`); }
    throw error;
  }
  await fs.unlink(backup);
}
