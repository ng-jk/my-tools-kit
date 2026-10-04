// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_FOLDER_TO_ALL_PROFILES } from '../../../data/sftp/constants';
import { checkFileCommand } from './abstract/createCommand';
import fileCommandUploadFolder from './fileCommandUploadFolder';

export default checkFileCommand({
  ...fileCommandUploadFolder,
  id: COMMAND_UPLOAD_FOLDER_TO_ALL_PROFILES
});
