import {confirmListedDownload} from './confirmListedDownload';
// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_DOWNLOAD_PROJECT } from '../../../data/sftp/constants';
import { downloadFolder } from '../fileHandlers/index';
import { selectContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_DOWNLOAD_PROJECT,
  getFileTarget: selectContext,

  async handleFile(ctx) {
    if(!await confirmListedDownload(ctx,true,false))return;
    await downloadFolder(ctx);
  },
});
