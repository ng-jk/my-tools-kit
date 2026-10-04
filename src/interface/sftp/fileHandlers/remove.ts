// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { refreshRemoteExplorer } from './shared';
import {removeRemotePath} from '../../../logic/sftp/remote-operations';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from '../../../logic/sftp/fileHandlers/option';
import logger from '../logger';

export const removeRemote = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'removeRemote',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;
    await removeRemotePath(remoteFs,remoteFsPath,this.config.remotePath,option.skipDir);
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
