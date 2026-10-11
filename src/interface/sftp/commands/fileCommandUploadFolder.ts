// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_FOLDER } from '../../../data/sftp/constants';
import { uploadSelection } from './uploadSelection';
import { checkFileCommand } from './abstract/createCommand';
import { selectLocalFolder } from './shared';

export default checkFileCommand({
  id: COMMAND_UPLOAD_FOLDER,
  getFileTarget: selectLocalFolder,

  async handleFile(ctx) { await uploadSelection(ctx, 'folder'); },
});
