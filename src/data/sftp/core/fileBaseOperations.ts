// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { FileSystem } from './fs/index';

import { Readable } from 'stream';
import { logger } from '../ports';

interface FileOption {
  mode?: number;
}

export async function transferFile(
  src: string,
  des: string,
  srcFs: FileSystem,
  desFs: FileSystem,
  option?: FileOption
): Promise<void> {
  const inputStream = await srcFs.get(src, option);
  await desFs.put(inputStream, des, option);
}

export function removeFile(path: string, fs: FileSystem, option?: FileOption): Promise<void> {
  return fs.unlink(path);
}

export function removeDir(path: string, fs: FileSystem, option?: FileOption): Promise<void> {
  return fs.rmdir(path, true);
}

export function rename(srcPath: string, destPath: string, fs: FileSystem): Promise<void> {
  return fs.rename(srcPath, destPath);
}

export function createDir(path: string, fs: FileSystem, option?: FileOption): Promise<void> {
  return fs.mkdir(path);
}

export async function createFile(path: string, fs: FileSystem, option?: FileOption): Promise<void> {
  let exists = false;
  try { await fs.lstat(path); exists = true; } catch (error) {
    if (![2, 'ENOENT', 550].includes(error.code)) throw error;
  }
  if (exists) throw new Error('File already exists: ' + path);
  if (!fs.supportsExclusiveCreate) throw new Error('This protocol cannot guarantee exclusive file creation; use SFTP Create File.');

  const targetFd = await fs.open(path, 'wx', option?.mode ?? 0o600);
  try { await fs.prepareStagedFile(path, '', option?.mode ?? 0o600, targetFd); }
  finally { await fs.close(targetFd); }
}
