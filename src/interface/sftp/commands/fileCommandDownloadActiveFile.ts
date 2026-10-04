// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_DOWNLOAD_ACTIVEFILE } from '../../../data/sftp/constants';
import { downloadFile } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { getActiveDocumentUri } from './shared';

export default checkFileCommand({
  id: COMMAND_DOWNLOAD_ACTIVEFILE,
  getFileTarget: getActiveDocumentUri,

  async handleFile(ctx) {
    await downloadFile(ctx, { ignore: null });
  },
});
