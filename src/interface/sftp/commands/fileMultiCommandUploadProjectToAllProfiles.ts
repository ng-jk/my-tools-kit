// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_PROJECT_TO_ALL_PROFILES } from '../../../data/sftp/constants';
import { checkFileCommand } from './abstract/createCommand';
import fileCommandUploadProject from './fileCommandUploadProject';

export default checkFileCommand({
  ...fileCommandUploadProject,
  id: COMMAND_UPLOAD_PROJECT_TO_ALL_PROFILES
});
