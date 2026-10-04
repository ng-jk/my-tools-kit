import {FileSystem, FileType} from '../../data/sftp/core/fs';
import {filesystemIdentity} from './core/staged-replacement';
const locks = new WeakMap<object, Map<string, Promise<void>>>();
export async function ensureTransferDirectory(source: FileSystem, target: FileSystem, from: string, to: string, override?: number) {
  const identity = (target as any)[filesystemIdentity] || target;
  let paths = locks.get(identity); if (!paths) {paths = new Map(); locks.set(identity, paths);}
  const key=target.pathIdentity ? target.pathIdentity(to) : to;
  const previous = paths.get(key) || Promise.resolve();
  let release: () => void; const current = new Promise<void>(resolve => {release = resolve;});
  paths.set(key, current); await previous;
  try { await ensure(source, target, from, to, override); }
  finally {release!(); if (paths.get(key) === current) paths.delete(key);}
}
async function ensure(source: FileSystem, target: FileSystem, from: string, to: string, override?: number) {
  let existing;
  try { existing = await target.lstat(to); }
  catch (error) { if (error.code !== 'ENOENT' && error.code !== 2) throw error; }
  if (existing) { await target.ensureDir(to); return; }
  const parent = target.pathResolver.dirname(to);
  if (parent !== to) await ensureTransferDirectory(source, target, source.pathResolver.dirname(from), parent, override);
  const stat = await source.lstat(from);
  if (stat.type !== FileType.Directory) throw new Error('Source parent is not a directory: ' + from);
  const mode = override !== undefined ? parseInt(String(override), 8) : stat.mode;
  if (typeof mode !== 'number') throw new Error('Source directory permissions are unavailable: ' + from);
  await target.ensureDir(to);
  try {
  await target.establishDirectoryMode(to, mode);
  } catch (error) { await target.rmdir(to, false).catch(() => {}); throw error; }
}
