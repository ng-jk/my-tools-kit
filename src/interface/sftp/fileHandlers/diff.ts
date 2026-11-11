// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as path from 'path';
import { ProgressLocation, TabInputTextDiff, Uri, window } from 'vscode';
import { diffFiles } from '../host';
import { downloadDiffFile } from '../../../logic/sftp/diff-download';
import createFileHandler from './createFileHandler';

const openSnapshots = new Set<() => Promise<void>>();

export async function disposeDiffSnapshots() {
  await Promise.all([...openSnapshots].map(dispose => dispose()));
}

export const diff = createFileHandler({
  name: 'diff',
  async handle() {
    const {localFsPath, remoteFsPath} = this.target;
    const {fileService, config} = this;
    const endpoint = config.host+':'+config.port;
    const profile = fileService.profile || 'base';
    const destination = [fileService.name, endpoint, profile, fileService.baseDir, remoteFsPath]
      .filter(Boolean).join(' · ');
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
      const uri = Uri.file(result.file).toString();
      const usesSnapshot = (input: unknown) => input instanceof TabInputTextDiff && input.original.toString() === uri;
      const tabs = window.tabGroups.onDidChangeTabs(event => {
        if (event.closed.some(tab => usesSnapshot(tab.input)) &&
          !window.tabGroups.all.some(group => group.tabs.some(tab => usesSnapshot(tab.input)))) void dispose();
      });
      const dispose = async () => {
        if (!openSnapshots.delete(dispose)) return;
        tabs.dispose();
        await result.dispose();
      };
      openSnapshots.add(dispose);
      try {
        await diffFiles(result.file, localFsPath, path.basename(localFsPath)+' ('+destination+' ↔ local)');
      } catch (error) {
        await dispose();
        throw error;
      }
    }
  },
});
