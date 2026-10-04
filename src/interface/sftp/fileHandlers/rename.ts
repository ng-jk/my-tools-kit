// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { fileOperations } from '../../../logic/sftp/core/index';
import createFileHandler from './createFileHandler';

export const renameRemote = createFileHandler<{ originPath: string }>({
  name: 'rename',
  async handle({ originPath }) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { localFsPath } = this.target;
    await fileOperations.rename(originPath, localFsPath, remoteFs);
  },
});
