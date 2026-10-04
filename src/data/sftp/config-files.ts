import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
export const readFileSync = fs.readFileSync;
export const existsSync = fs.existsSync;
export function replaceHomePath(value: string) { return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value; }
export function resolvePath(base: string, value: string) { return path.resolve(base, replaceHomePath(value)); }
export function toRemotePath(local: string, base: string, remote: string) {
  const relative = path.relative(base, local);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Local path is outside the configured context');
  return path.posix.join(remote, relative.split(path.sep).join('/'));
}
export function toLocalPath(remote: string, base: string, local: string) {
  const relative = path.posix.relative(base.replace(/\\/g, '/'), remote.replace(/\\/g, '/'));
  if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) throw new Error('Remote path is outside the configured root');
  return path.join(local, relative);
}
