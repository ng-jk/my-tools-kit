// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_DOWNLOAD_FOLDER } from '../../../data/sftp/constants';
import { downloadFolder } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_DOWNLOAD_FOLDER,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  handleFile: downloadFolder,
});
