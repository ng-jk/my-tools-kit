import {confirmListedDownload} from './confirmListedDownload';
// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_FORCE_DOWNLOAD } from '../../../data/sftp/constants';
import { download } from '../fileHandlers/index';
import { selectRemoteTarget } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_FORCE_DOWNLOAD,
  getFileTarget: selectRemoteTarget,

  async handleFile(ctx) {
    if(!await confirmListedDownload(ctx,undefined,true))return;
    await download(ctx, { ignore: null });
  },
});
