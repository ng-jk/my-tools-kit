// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_TO_ALL_PROFILES } from '../../../data/sftp/constants';
import { checkFileCommand } from './abstract/createCommand';
import fileCommandUpload from './fileCommandUpload';

export default checkFileCommand({
  ...fileCommandUpload,
  id: COMMAND_UPLOAD_TO_ALL_PROFILES
});
