// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD } from '../../../data/sftp/constants';
import { upload } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromfspath } from './shared';

export default checkFileCommand({
  id: COMMAND_UPLOAD,
  getFileTarget: uriFromfspath,

  async handleFile(ctx) {
    await upload(ctx, { ignore: null });
  },
});
