// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_FOLDER } from '../../../data/sftp/constants';
import { uploadFolder } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_UPLOAD_FOLDER,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  handleFile: uploadFolder,
});
