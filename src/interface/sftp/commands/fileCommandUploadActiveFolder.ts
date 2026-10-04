// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_ACTIVEFOLDER } from '../../../data/sftp/constants';
import { checkFileCommand } from './abstract/createCommand';
import { getActiveFolder } from './shared';
import fileCommandUploadFolder from './fileCommandUploadFolder';

export default checkFileCommand({
  ...fileCommandUploadFolder,
  id: COMMAND_UPLOAD_ACTIVEFOLDER,
  getFileTarget: getActiveFolder,
});
