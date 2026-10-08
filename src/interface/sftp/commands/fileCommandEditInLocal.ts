// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import {confirmListedDownload} from './confirmListedDownload';
import { COMMAND_REMOTEEXPLORER_EDITINLOCAL } from '../../../data/sftp/constants';
import { downloadFile } from '../fileHandlers/index';
import { showTextDocument } from '../host';
import { selectRemoteTarget } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_REMOTEEXPLORER_EDITINLOCAL,
  getFileTarget: selectRemoteTarget,

  async handleFile(ctx) {
    if(!await confirmListedDownload(ctx,false,true))return;
    await downloadFile(ctx, { ignore: null });
    await showTextDocument(ctx.target.localUri, { preview: true });
  },
});
