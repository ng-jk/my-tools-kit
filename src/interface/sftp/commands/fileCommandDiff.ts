// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_DIFF } from '../../../data/sftp/constants';
import { diff } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_DIFF,
  getFileTarget: uriFromExplorerContextOrEditorContext,
  handleFile: diff,
});
