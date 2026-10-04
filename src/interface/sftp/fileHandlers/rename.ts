// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { fileOperations } from '../../../logic/sftp/core/index';
import createFileHandler from './createFileHandler';
import { toRemotePath } from '../../../data/sftp/config-files';
import {renameRemotePath} from '../../../logic/sftp/remote-operations';

export const renameRemote = createFileHandler<{ originPath: string }>({
  name: 'rename',
  async handle({ originPath }) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const source = toRemotePath(originPath, this.fileService.baseDir, this.config.remotePath);
    await renameRemotePath(remoteFs, source, this.target.remoteFsPath, this.config.remotePath);
  },
});
