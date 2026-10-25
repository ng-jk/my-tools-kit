import {createServerDirectory,createServerFile} from '../../../logic/sftp/server-permissions';
// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import {assertRemoteAncestors} from '../../../logic/sftp/remote-operations';
import { refreshRemoteExplorer } from './shared';
import { fileOperations } from '../../../logic/sftp/core/index';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from '../../../logic/sftp/fileHandlers/option';

export const createRemoteFile = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'createRemoteFile',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;
    await assertRemoteAncestors(remoteFs,remoteFsPath,this.config.remotePath,false,true);

    let promise;
    promise = createServerFile(remoteFs,remoteFsPath,this.config.filePerm);

    /*
    const stat = await remoteFs.lstat(remoteFsPath);
    switch (stat.type) {
      case FileType.Directory:
        if (option.skipDir) {
          return;
        }
        promise = createServerDirectory(remoteFs,remoteFsPath,this.config.dirPerm,true);
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
    await assertRemoteAncestors(remoteFs,remoteFsPath,this.config.remotePath,false,true);

    let promise;
    promise = createServerDirectory(remoteFs,remoteFsPath,this.config.dirPerm,true);

    /*
    const stat = await remoteFs.lstat(remoteFsPath);
    switch (stat.type) {
      case FileType.Directory:
        if (option.skipDir) {
          return;
        }
        promise = createServerDirectory(remoteFs,remoteFsPath,this.config.dirPerm,true);
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
