// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as fs from 'fs';
import {protectWindowsDirectory, protectWindowsStagingFile} from '../../windows-directory-permissions';
import * as fse from 'fs-extra';
import * as paths from 'path';
import {trackLocalChanges, rememberLocalState} from '../../local-events';
import FileSystem, { FileEntry, FileStats, FileOption } from './fileSystem';

export default class LocalFileSystem extends FileSystem {
  constructor(pathResolver: any, private root?: string) {
    super(pathResolver);
  }

  pathIdentity(value: string): string {
    const normalized=paths.resolve(value);
    return process.platform==='win32'||process.platform==='darwin' ? normalized.toLowerCase() : normalized;
  }
  async establishDirectoryMode(path: string, mode: number): Promise<void> {
    this.assertWritable(path);
    if (process.platform === 'win32') { await protectWindowsDirectory(path); return; }
    await super.establishDirectoryMode(path, mode);
  }

  private assertWritable(target: string, includeLeaf = true) {
    if (!this.root) return;
    const root = paths.resolve(this.root), absolute = paths.resolve(target);
    const relative = paths.relative(root, absolute);
    if (relative === '..' || relative.startsWith('..' + paths.sep) || paths.isAbsolute(relative)) throw new Error('Write escapes the configured local context');
    const parts = relative.split(paths.sep).filter(Boolean);
    if (!includeLeaf) parts.pop();
    let current = root;
    for (const part of parts) {
      current = paths.join(current, part);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Refusing a write through a destination symlink: ' + current);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  private async track<T>(values: string[], operation: () => Promise<T>): Promise<T> {
    if (!this.root) return operation();
    try { return await trackLocalChanges(values, operation); }
    finally {
      for (const value of values) {
        let parent = paths.dirname(paths.resolve(value));
        const root = paths.resolve(this.root);
        while (parent === root || parent.startsWith(root + paths.sep)) {
          rememberLocalState(parent);
          if (parent === root) break;
          parent = paths.dirname(parent);
        }
      }
    }
  }

  toFileStat(stat: fs.Stats): FileStats {
    return {
      type: FileSystem.getFileTypecharacter(stat),
      size: stat.size,
      mode: stat.mode & parseInt('777', 8), // tslint:disable-line:no-bitwise
      mtime: stat.mtime.getTime(),
      atime: stat.atime.getTime(),
    };
  }

  lstat(path: string): Promise<FileStats> {
    return new Promise((resolve, reject) => {
      fs.lstat(path, (err, stat: fs.Stats) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(this.toFileStat(stat));
      });
    });
  }

  readFile(path: string, option?: FileOption): Promise<string | Buffer> {
    return new Promise((resolve, reject) => {
      fs.readFile(path, option as any, (err, data) => {
        if (err) {
          return reject(err);
        }

        resolve(data);
      });
    });
  }

  open(path: string, flags: string, mode?: number): Promise<number> {
    if (/[wa+]/.test(flags)) this.assertWritable(path);
    return fse.open(path, flags, mode);
  }

  async prepareStagedFile(path: string, destination: string, mode?: number, fd?: number): Promise<void> {
    this.assertWritable(path); if (destination) this.assertWritable(destination);
    if (process.platform === "win32") await protectWindowsStagingFile(path, destination);
    else if (typeof mode === 'number' && fd !== undefined) {
      await fse.fchmod(fd, mode);
      const actual=await fse.fstat(fd);
      if ((actual.mode & 0o777)!==(mode & 0o777)) throw new Error('Cannot establish required staging file permissions');
    }
  }

  close(fd: number): Promise<void> {
    return fse.close(fd);
  }

  fstat(fd: number): Promise<FileStats> {
    return fse.fstat(fd).then(stat => this.toFileStat(stat));
  }

  futimes(fd: number, atime: number, mtime: number): Promise<void> {
    return fse.futimes(fd, atime, mtime);
  }

  get(path: string, option?: FileOption): Promise<fs.ReadStream> {
    return new Promise((resolve, reject) => {
      try {
        const stream = fs.createReadStream(path, option as any);
        stream.once('error', reject);
        resolve(stream);
      } catch (err) {
        reject(err);
      }
    });
  }

  async chmod(path: string, mode: number): Promise<void> {
    this.assertWritable(path);
    return new Promise((resolve, reject) => {
      fs.chmod(path, mode, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  put(input: fs.ReadStream, path: string, option?: FileOption): Promise<void> {
    this.assertWritable(path);
    return new Promise<void>((resolve, reject) => {
      if (option && option.fd && typeof option.fd !== 'number') {
        return reject(new Error('fd is not a number'));
      }

      const writer = fs.createWriteStream(path, option as any);
      writer.once('error', reject).once('finish', resolve); // transffered

      input.once('error', err => {
        reject(err);
        writer.end();
      });
      input.pipe(writer);
    });
  }

  readlink(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readlink(path, (err, linkString) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(linkString);
      });
    });
  }

  symlink(targetPath: string, path: string): Promise<void> {
    this.assertWritable(path, false);
    this.assertWritable(paths.resolve(paths.dirname(path), targetPath));
    return new Promise<void>((resolve, reject) => {
      fs.symlink(targetPath, path, null, err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  mkdir(dir: string): Promise<void> {
    this.assertWritable(dir);
    return new Promise<void>((resolve, reject) => {
      fs.mkdir(dir, err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  ensureDir(dir: string): Promise<void> {
    this.assertWritable(dir);
    return this.track([dir], () => fse.ensureDir(dir));
  }

  toFileEntry(fullPath: string, stat: FileStats): FileEntry {
    return {
      fspath: fullPath,
      name: this.pathResolver.basename(fullPath),
      ...stat,
    };
  }

  list(dir: string): Promise<FileEntry[]> {
    return new Promise((resolve, reject) => {
      fs.readdir(dir, (err, files) => {
        if (err) {
          reject(err);
          return;
        }

        const fileStatus = files.map(file => {
          const fspath = this.pathResolver.join(dir, file);
          return this.lstat(fspath).then(stat =>
            this.toFileEntry(fspath, stat)
          );
        });

        resolve(Promise.all(fileStatus));
      });
    });
  }

  unlink(path: string): Promise<void> {
    this.assertWritable(path, false);
    return this.track([path], () => new Promise<void>((resolve, reject) => {
      fs.unlink(path, err => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    }));
  }

  rmdir(path: string, recursive: boolean): Promise<void> {
    this.assertWritable(path, false);
    if (recursive) {
      return this.track([path], () => fse.remove(path));
    }

    return this.track([path], () => new Promise<void>((resolve, reject) => {
      fs.rmdir(path, err => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    }));
  }

  rename(srcPath: string, destPath: string): Promise<void> {
    this.assertWritable(srcPath, false); this.assertWritable(destPath, false);
    return this.track([srcPath, destPath], () => fse.rename(srcPath, destPath));
  }

  renameAtomic(srcPath: string, destPath: string): Promise<void> {
    return this.rename(srcPath, destPath);
  }
}
