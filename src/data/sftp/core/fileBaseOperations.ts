// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { FileSystem, FileType } from './fs/index';

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
  const incomplete = (error: any) => Object.assign(new Error('New file creation did not finish. An entry may remain at '+path+'. Inspect it in SFTP Remote Explorer and remove it only if safe before retrying this name, or choose another name. '+error.message), {code:'CREATE_FILE_INCOMPLETE',remotePath:path});
  try {
    await fs.prepareStagedFile(path, '', option?.mode ?? 0o600, targetFd);
    // SFTP creation may be masked by the server's umask. Apply the requested
    // mode through the exclusive descriptor, then verify without following links.
    if(option?.mode !== undefined && typeof (fs as any).fchmod === 'function'){
      await (fs as any).fchmod(targetFd,option.mode).catch(()=>{});
      const actual=await fs.fstat(targetFd);
      if(actual.type!==FileType.File || !Number.isInteger(actual.mode) || (actual.mode&0o777)!==option.mode)throw new Error('Created empty server file, but required permissions could not be verified: '+path);
    }
  }
  catch(error) {throw incomplete(error);}
  finally { await fs.close(targetFd).catch(error=>{throw incomplete(error);}); }
}
