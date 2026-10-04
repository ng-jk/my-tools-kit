// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_ACTIVEFOLDER_TO_ALL_PROFILES } from '../../../data/sftp/constants';
import { checkFileCommand } from './abstract/createCommand';
import fileCommandUploadActiveFolder from './fileCommandUploadActiveFolder';

export default checkFileCommand({
  ...fileCommandUploadActiveFolder,
  id: COMMAND_UPLOAD_ACTIVEFOLDER_TO_ALL_PROFILES,
});
