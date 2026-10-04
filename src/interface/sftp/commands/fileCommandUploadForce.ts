// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_FORCE_UPLOAD } from '../../../data/sftp/constants';
import { upload } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_FORCE_UPLOAD,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await upload(ctx, { ignore: null });
  },
});
