// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_REVEAL_IN_EXPLORER } from '../../../data/sftp/constants';
import { executeCommand } from '../host';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_REVEAL_IN_EXPLORER,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile({ target }) {
    await executeCommand('revealInExplorer', target.localUri);
  },
});
