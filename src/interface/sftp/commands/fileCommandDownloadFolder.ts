import {confirmListedDownload} from './confirmListedDownload';
// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_DOWNLOAD_FOLDER } from '../../../data/sftp/constants';
import { downloadFolder } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { selectRemoteFolder } from './shared';

export default checkFileCommand({
  id: COMMAND_DOWNLOAD_FOLDER,
  getFileTarget: selectRemoteFolder,

  async handleFile(ctx) {
    if(!await confirmListedDownload(ctx,true))return;
    await downloadFolder(ctx);
  },
});
