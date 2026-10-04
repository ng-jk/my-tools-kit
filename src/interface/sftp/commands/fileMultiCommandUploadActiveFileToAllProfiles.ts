// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_ACTIVEFILE_TO_ALL_PROFILES } from '../../../data/sftp/constants';
import { checkFileCommand } from './abstract/createCommand';
import fileCommandUploadActiveFile from './fileCommandUploadActiveFile';


export default checkFileCommand({
  ...fileCommandUploadActiveFile,
  id: COMMAND_UPLOAD_ACTIVEFILE_TO_ALL_PROFILES
});
