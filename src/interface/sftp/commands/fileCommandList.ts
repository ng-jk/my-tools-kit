// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_LIST } from '../../../data/sftp/constants';
import { showTextDocument } from '../host';
import { FileType } from '../../../logic/sftp/core/index';
import { downloadFile, downloadFolder } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { selectFile } from './shared';

export default checkFileCommand({
  id: COMMAND_LIST,
  getFileTarget: selectFile,

  async handleFile(ctx) {
    const remotefs = await ctx.fileService.getRemoteFileSystem(ctx.config);
    const fileEntry = await remotefs.lstat(ctx.target.remoteFsPath);
    if (fileEntry.type !== FileType.Directory) {
      await downloadFile(ctx);
      try {
        await showTextDocument(ctx.target.localUri);
      } catch (error) {
        // ignore
      }
    } else {
      await downloadFolder(ctx);
    }
  },
});
