// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_PROJECT } from '../../../data/sftp/constants';
import { uploadSelection } from './uploadSelection';
import { selectContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_UPLOAD_PROJECT,
  getFileTarget: selectContext,

  async handleFile(ctx) { await uploadSelection(ctx, 'folder'); },
});
