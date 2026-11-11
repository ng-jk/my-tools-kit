// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as path from 'path';
import { unlink } from 'fs/promises';
import { ProgressLocation, window } from 'vscode';
import { diffFiles } from '../host';
import { EXTENSION_NAME } from '../../../data/sftp/constants';
import { FileType, LocalFileSystem, TransferDirection, TransferTask } from '../../../logic/sftp/core/index';
import { registerActiveTransfer } from '../../../logic/sftp/transfer-operation';
import { makeTmpFile } from '../helper/index';
import createFileHandler from './createFileHandler';
import {requireDiffFile} from '../../../logic/sftp/diagnostics';

export const diff = createFileHandler({
  name: 'diff',
  async handle() {
    const { localFsPath, remoteFsPath } = this.target;
    const { fileService, config } = this;
    const title = path.basename(localFsPath);
    await window.withProgress({
      location: ProgressLocation.Notification,
      title: 'Comparing '+title+' with remote',
      cancellable: true,
    }, async (_progress, token) => {
      const checkService = fileService.cancellationCheck();
      const release = fileService.retainTransferResources();
      let cancelled = false;
      let task: TransferTask | undefined;
      let tmpPath: string | undefined;
      const cancel = () => { cancelled = true; task?.cancel(); };
      const check = () => {
        checkService();
        if (cancelled || token.isCancellationRequested) throw new Error('Transfer cancelled');
      };
      const unregister = registerActiveTransfer(cancel);
      const removeListener = fileService.onCancellation(cancel);
      const subscription = token.onCancellationRequested(cancel);
      try {
        check();
        await requireDiffFile(fileService.getLocalFileSystem(), localFsPath, 'local', FileType.File);
        check();
        const remoteFs = await fileService.getRemoteFileSystem(config);
        check();
        await requireDiffFile(remoteFs, remoteFsPath, 'remote', FileType.File);
        check();
        tmpPath = await makeTmpFile({prefix: EXTENSION_NAME+'-', postfix: path.extname(localFsPath)});
        check();
        const localFs = new LocalFileSystem(path, path.dirname(tmpPath));
        task = new TransferTask(
          {fsPath: remoteFsPath, fileSystem: remoteFs},
          {fsPath: tmpPath, fileSystem: localFs},
          {
            fileType: FileType.File,
            transferDirection: TransferDirection.REMOTE_TO_LOCAL,
            transferOption: {atime: 0, mtime: 0, mode: 0o600, perserveTargetMode: false},
          },
        );
        await task.run();
        check();
        await diffFiles(tmpPath, localFsPath, title+' ('+(fileService.name || 'remote')+' ↔ local)');
        tmpPath = undefined; // The diff editor still needs the downloaded file.
      } catch (error) {
        if (!cancelled && !token.isCancellationRequested) throw error;
      } finally {
        subscription.dispose();
        removeListener();
        unregister();
        try {
          if (tmpPath) await unlink(tmpPath).catch(() => {});
        } finally {
          release();
        }
      }
    });
  },
});
