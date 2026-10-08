// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import {confirmListedDownload} from './confirmListedDownload';
import { COMMAND_LIST_ALL } from '../../../data/sftp/constants';
import { showTextDocument } from '../host';
import { FileType } from '../../../logic/sftp/core/index';
import { downloadFile, downloadFolder } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { selectFileFromAll } from './shared';

export default checkFileCommand({
  id: COMMAND_LIST_ALL,
  getFileTarget: selectFileFromAll,

  async handleFile(ctx) {
    const remotefs = await ctx.fileService.getRemoteFileSystem(ctx.config);
    const fileEntry = await remotefs.lstat(ctx.target.remoteFsPath);
    if(!await confirmListedDownload(ctx,fileEntry.type===FileType.Directory,true))return;
    if (fileEntry.type !== FileType.Directory) {
      await downloadFile(ctx, { ignore: null });
      try {
        await showTextDocument(ctx.target.localUri);
      } catch (error) {
        // ignore
      }
    } else {
      await downloadFolder(ctx, { ignore: null });
    }
  },
});
