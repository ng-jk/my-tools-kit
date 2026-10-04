// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_FORCE_UPLOAD_TO_ALL_PROFILES } from '../../../data/sftp/constants';
import { checkFileCommand } from './abstract/createCommand';
import fileCommandUploadForce from './fileCommandUploadForce';

export default checkFileCommand({
  ...fileCommandUploadForce,
  id: COMMAND_FORCE_UPLOAD_TO_ALL_PROFILES
});
