// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_REMOTEEXPLORER_EDITINLOCAL } from '../../../data/sftp/constants';
import { downloadFile } from '../fileHandlers/index';
import { showTextDocument } from '../host';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_REMOTEEXPLORER_EDITINLOCAL,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await downloadFile(ctx, { ignore: null });
    await showTextDocument(ctx.target.localUri, { preview: true });
  },
});
