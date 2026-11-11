// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as path from 'path';
import { ProgressLocation, window } from 'vscode';
import { diffFiles } from '../host';
import { downloadDiffFile } from '../../../logic/sftp/diff-download';
import createFileHandler from './createFileHandler';

export const diff = createFileHandler({
  name: 'diff',
  async handle() {
    const {localFsPath, remoteFsPath} = this.target;
    const {fileService, config} = this;
    const destination = (fileService.name || config.host)+' / '+(fileService.profile || 'base')+': '+remoteFsPath;
    const result = await window.withProgress({
      location: ProgressLocation.Notification,
      title: 'Comparing with '+destination,
      cancellable: true,
    }, async (_progress, token) => {
      const controller = new AbortController();
      const subscription = token.onCancellationRequested(() => controller.abort());
      if (token.isCancellationRequested) controller.abort();
      try { return await downloadDiffFile(fileService, config, localFsPath, remoteFsPath, controller.signal); }
      finally { subscription.dispose(); }
    });
    if (result) {
      try {
        await diffFiles(result.file, localFsPath, path.basename(localFsPath)+' ('+destination+' ↔ local)');
      } catch (error) {
        await result.dispose();
        throw error;
      }
    }
  },
});
