// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as path from 'path';
import { diffFiles } from '../host';
import { EXTENSION_NAME } from '../../../data/sftp/constants';
import { fileOperations, LocalFileSystem } from '../../../logic/sftp/core/index';
import { makeTmpFile } from '../helper/index';
import createFileHandler from './createFileHandler';

export const diff = createFileHandler({
  name: 'diff',
  async handle() {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { localFsPath, remoteFsPath } = this.target;
    const tmpPath = await makeTmpFile({
      prefix: `${EXTENSION_NAME}-`,
      postfix: path.extname(localFsPath),
    });
    const localFs = new LocalFileSystem(path, path.dirname(tmpPath));

    await fileOperations.transferFile(remoteFsPath, tmpPath, remoteFs, localFs);
    await diffFiles(
      tmpPath,
      localFsPath,
      `${path.basename(localFsPath)} (${this.fileService.name || 'remote'} ↔ local)`
    );
  },
});
