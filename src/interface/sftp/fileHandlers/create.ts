// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { refreshRemoteExplorer } from './shared';
import { fileOperations } from '../../../logic/sftp/core/index';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from '../../../logic/sftp/fileHandlers/option';

export const createRemoteFile = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'createRemoteFile',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;

    let promise;
    promise = fileOperations.createFile(remoteFsPath, remoteFs, {});

    /*
    const stat = await remoteFs.lstat(remoteFsPath);
    switch (stat.type) {
      case FileType.Directory:
        if (option.skipDir) {
          return;
        }
        promise = fileOperations.createDir(remoteFsPath, remoteFs, {});
        // promise = fileOperations.removeDir(remoteFsPath, remoteFs, {});
        break;
      case FileType.File:
      case FileType.SymbolicLink:
        // promise = fileOperations.removeFile(remoteFsPath, remoteFs, {});
        break;
      default:
        throw new Error(`Unsupported file type (type = ${stat.type})`);
    }*/
    await promise;
  },
  transformOption() {
    const config = this.config;
    return {
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, false);
  },
});

export const createRemoteFolder = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'createRemoteFolder',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;

    let promise;
    promise = fileOperations.createDir(remoteFsPath, remoteFs, {});

    /*
    const stat = await remoteFs.lstat(remoteFsPath);
    switch (stat.type) {
      case FileType.Directory:
        if (option.skipDir) {
          return;
        }
        promise = fileOperations.createDir(remoteFsPath, remoteFs, {});
        // promise = fileOperations.removeDir(remoteFsPath, remoteFs, {});
        break;
      case FileType.File:
      case FileType.SymbolicLink:
        // promise = fileOperations.removeFile(remoteFsPath, remoteFs, {});
        break;
      default:
        throw new Error(`Unsupported file type (type = ${stat.type})`);
    }*/
    await promise;
  },
  transformOption() {
    const config = this.config;
    return {
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, false);
  },
});
