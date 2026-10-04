// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { Readable } from 'stream';
import {stagingPath, replaceStaged} from './staged-replacement';
import {beginLocalChange} from '../../../data/sftp/local-events';
import {transferPermissions} from '../transfer-permissions';
import { FileSystem, FileType } from '../../../data/sftp/core/fs/index';
import { Task } from './scheduler';
import { logger } from '../../../data/sftp/ports';

let hasWarnedModifedTimePermission = false;

export enum TransferDirection {
  LOCAL_TO_REMOTE = 'local ➞ remote',
  REMOTE_TO_LOCAL = 'remote ➞ local',
}

interface FileHandle {
  fsPath: string;
  fileSystem: FileSystem;
}

export interface TransferOption {
  atime: number;
  mtime: number;
  mode?: number;
  filePerm?: number;
  dirPerm?: number;
  fallbackMode?: number;
  perserveTargetMode: boolean;
  useTempFile?: boolean;
  openSsh?: boolean;
}

export default class TransferTask implements Task {
  readonly fileType: FileType;
  private readonly _srcFsPath: string;
  private readonly _targetFsPath: string;
  private readonly _srcFs: FileSystem;
  private readonly _targetFs: FileSystem;
  private readonly _transferDirection: TransferDirection;
  private readonly _TransferOption: TransferOption;
  private _handle: Readable;
  private _cancelled: boolean;
  // private _fileStatus: FileStatus;

  constructor(
    src: FileHandle,
    target: FileHandle,
    option: {
      fileType: FileType;
      transferDirection: TransferDirection;
      transferOption: TransferOption;
    }
  ) {
    this._srcFsPath = src.fsPath;
    this._targetFsPath = target.fsPath;
    this._srcFs = src.fileSystem;
    this._targetFs = target.fileSystem;
    this._TransferOption = option.transferOption;
    this._transferDirection = option.transferDirection;
    this.fileType = option.fileType;
  }

  get localFsPath() {
    if (this._transferDirection === TransferDirection.REMOTE_TO_LOCAL) {
      return this._targetFsPath;
    } else {
      return this._srcFsPath;
    }
  }

  get srcFsPath() {
    return this._srcFsPath;
  }

  get targetFsPath() {
    return this._targetFsPath;
  }

  get transferType() {
    return this._transferDirection;
  }

  async run() {
    const finish = this._transferDirection === TransferDirection.REMOTE_TO_LOCAL ? beginLocalChange(this._targetFsPath) : () => {};
    try { await this.runTransfer(); } finally { finish(); }
  }

  private checkCancelled = () => { if (this._cancelled) throw new Error("Transfer cancelled"); };

  private async runTransfer() {
    this.checkCancelled();
    const src = this._srcFsPath;
    const target = this._targetFsPath;
    const srcFs = this._srcFs;
    const targetFs = this._targetFs;
    switch (this.fileType) {
      case FileType.File:
        await this._transferFile();
        break;
      case FileType.SymbolicLink:
        const link = await srcFs.readlink(src);
        this.checkCancelled();
        const stagedLink = stagingPath(target);
        try {
          await targetFs.symlink(link, stagedLink);
          await replaceStaged(targetFs, stagedLink, target, this._TransferOption.openSsh, this.checkCancelled);
        } finally { await targetFs.unlink(stagedLink).catch(() => {}); }
        break;
      default:
        logger.warn(`Unsupported file type (type = ${this.fileType}). File ${src}`);
    }
  }

  cancel() {
    this._cancelled = true;
    if (this._handle && !this._handle.destroyed) FileSystem.abortReadableStream(this._handle);
  }

  isCancelled(): boolean {
    return this._cancelled;
  }

  private async _transferFile() {
    const srcFs = this._srcFs, targetFs = this._targetFs, target = this._targetFsPath;
    const {openSsh, fallbackMode, atime, mtime} = this._TransferOption;
    const {filePerm} = transferPermissions(this._TransferOption, this._transferDirection === TransferDirection.LOCAL_TO_REMOTE);
    let mode = filePerm ? parseInt(String(filePerm), 8) : this._TransferOption.mode;
    const staged = stagingPath(target);
    let fd: any;
    let sourceError: Error | undefined;
    const rememberError = (error: Error) => { sourceError = error; };
    try {
      if (this._cancelled) throw new Error('Transfer cancelled');
      this._handle = await srcFs.get(this._srcFsPath);
      this._handle.pause();
      this._handle.on('error', rememberError);
      if (mode === undefined) {
        try { const stat = await targetFs.lstat(target); mode = stat.type === FileType.File ? stat.mode : fallbackMode; }
        catch (error) { if (error.code !== 'ENOENT' && error.code !== 2) throw error; mode = fallbackMode; }
      }
      if (sourceError) throw sourceError;
      if (this._cancelled) throw new Error('Transfer cancelled');
      fd = await targetFs.open(staged, 'wx', mode);
      await targetFs.prepareStagedFile?.(staged, target, mode, fd);
      if (sourceError) throw sourceError;
      this.checkCancelled();
      await targetFs.put(this._handle, staged, {mode, fd, autoClose:false});
      if (sourceError) throw sourceError;
      if (this._cancelled) throw new Error('Transfer cancelled');
      if (atime && mtime) {
        try { await targetFs.futimes(fd, Math.floor(atime / 1000), Math.floor(mtime / 1000)); }
        catch (error) {
          if (!hasWarnedModifedTimePermission) { hasWarnedModifedTimePermission = true; logger.warn(`Can't set modified time: ${error.message}`); }
        }
      }
      await targetFs.close(fd); fd = undefined;
      await replaceStaged(targetFs, staged, target, openSsh, this.checkCancelled);
    } finally {
      if (this._handle) { this._handle.destroy(); this._handle.removeListener('error', rememberError); }
      if (fd !== undefined) await targetFs.close(fd).catch(error => logger.warn(error.message));
      await targetFs.unlink(staged).catch(() => {});
    }
  }
}
