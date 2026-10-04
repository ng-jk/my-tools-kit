import {FileSystem, FileType} from '../../data/sftp/core/fs';
import {filesystemIdentity} from './core/staged-replacement';
const locks = new WeakMap<object, Map<string, Promise<void>>>();
export async function ensureTransferDirectory(source: FileSystem, target: FileSystem, from: string, to: string, override?: number, scope?: DirectoryPermissionScope, ancestor = false) {
  return withDirectoryLock(target, to, () => ensure(source, target, from, to, override, scope, ancestor));
}
async function withDirectoryLock(target: FileSystem, to: string, operation: () => Promise<void>) {
  const identity = (target as any)[filesystemIdentity] || target;
  let paths = locks.get(identity); if (!paths) {paths = new Map(); locks.set(identity, paths);}
  const key=target.pathIdentity ? target.pathIdentity(to) : to;
  const previous = paths.get(key) || Promise.resolve();
  let release: () => void; const current = new Promise<void>(resolve => {release = resolve;});
  paths.set(key, current); await previous;
  try { await operation(); }
  finally {release!(); if (paths.get(key) === current) paths.delete(key);}
}
async function ensure(source: FileSystem, target: FileSystem, from: string, to: string, override?: number, scope?: DirectoryPermissionScope, ancestor = false) {
  let existing;
  try { existing = await target.lstat(to); }
  catch (error) { if (error.code !== 'ENOENT' && error.code !== 2) throw error; }
  if (existing) {
    await target.ensureDir(to);
    const requested = ancestor || override === undefined ? undefined : parseInt(String(override), 8);
    if (scope) await scope.establish(target, to, requested);
    else if (requested !== undefined) await target.establishDirectoryMode(to, requested);
    return;
  }
  const parent = target.pathResolver.dirname(to);
  if (parent !== to) await ensureTransferDirectory(source, target, source.pathResolver.dirname(from), parent, override, scope, true);
  const stat = await source.lstat(from);
  if (stat.type !== FileType.Directory) throw new Error('Source parent is not a directory: ' + from);
  const mode = override !== undefined ? parseInt(String(override), 8) : stat.mode;
  if (typeof mode !== 'number') throw new Error('Source directory permissions are unavailable: ' + from);
  await target.ensureDir(to);
  try {
  if (scope) await scope.establish(target, to, mode);
  else await target.establishDirectoryMode(to, mode);
  } catch (error) { await target.rmdir(to, false).catch(() => {}); throw error; }
}

interface DirectoryLease {fs: FileSystem; path: string; key: string; mode: number; count: number; ready: Promise<void>;}
const leases = new WeakMap<object, Map<string, DirectoryLease>>();
export class DirectoryPermissionScope {
  private held = new Set<DirectoryLease>();
  async establish(fs: FileSystem, path: string, mode?: number) {
    const identity = (fs as any)[filesystemIdentity] || fs;
    let paths = leases.get(identity); if (!paths) { paths = new Map(); leases.set(identity, paths); }
    const key = fs.pathIdentity(path);
    let entry = paths.get(key);
    if (!entry) {
      if (mode === undefined) return;
      entry = {fs: identity, path, key, mode, count: 0, ready: Promise.resolve()};
      paths.set(key, entry);
      // Grant only the owner's temporary write/search bits. Other users never
      // receive broader access than the requested final mode.
      entry.ready = fs.establishDirectoryMode(path, mode | 0o300);
    } else if (mode !== undefined && entry.mode !== mode) {
      throw new Error('Conflicting directory permissions in concurrent transfers: ' + path);
    }
    if (!this.held.has(entry)) { this.held.add(entry); entry.count++; }
    await entry.ready;
  }
  async finish() {
    const errors: unknown[] = [];
    for (const entry of [...this.held].sort((a,b) => b.path.length-a.path.length)) {
      await withDirectoryLock(entry.fs, entry.path, async () => {
        if (--entry.count !== 0) return;
        const paths = leases.get(entry.fs)!;
        try {
          try { await entry.ready; } catch { return; }
          await entry.fs.establishDirectoryMode(entry.path, entry.mode);
        } catch (error) { errors.push(error); }
        finally { paths.delete(entry.key); }
      });
    }
    this.held.clear();
    if (errors.length) throw errors[0];
  }
}
