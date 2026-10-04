import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
export const readFileSync = fs.readFileSync;
export const existsSync = fs.existsSync;
export function replaceHomePath(value: string) { return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value; }
export function resolvePath(base: string, value: string) { return path.resolve(base, replaceHomePath(value)); }
export function toRemotePath(local: string, base: string, remote: string) {
  return path.posix.join(remote, path.relative(base, local).split(path.sep).join('/'));
}
export function toLocalPath(remote: string, base: string, local: string) { return path.join(local, path.posix.relative(base, remote)); }
