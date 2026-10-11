// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_FILE } from '../../../data/sftp/constants';
import { uploadSelection } from './uploadSelection';
import { checkFileCommand } from './abstract/createCommand';
import { selectLocalFile } from './shared';

export default checkFileCommand({
  id: COMMAND_UPLOAD_FILE,
  getFileTarget: selectLocalFile,

  async handleFile(ctx) {
    await uploadSelection(ctx, 'file', false);
  },
});
