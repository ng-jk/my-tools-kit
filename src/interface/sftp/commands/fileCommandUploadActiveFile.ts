// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_ACTIVEFILE } from '../../../data/sftp/constants';
import { uploadSelection } from './uploadSelection';
import { checkFileCommand } from './abstract/createCommand';
import { getActiveDocumentUri } from './shared';

export default checkFileCommand({
  id: COMMAND_UPLOAD_ACTIVEFILE,
  getFileTarget: getActiveDocumentUri,

  async handleFile(ctx) {
    await uploadSelection(ctx, 'file', false);
  },
});
