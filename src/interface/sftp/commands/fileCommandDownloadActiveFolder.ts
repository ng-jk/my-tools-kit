// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_DOWNLOAD_ACTIVEFOLDER } from '../../../data/sftp/constants';
import { checkFileCommand } from './abstract/createCommand';
import { getActiveFolder } from './shared';
import fileCommandDownloadFolder from './fileCommandDownloadFolder';

export default checkFileCommand({
  ...fileCommandDownloadFolder,
  id: COMMAND_DOWNLOAD_ACTIVEFOLDER,
  getFileTarget: getActiveFolder,
});
