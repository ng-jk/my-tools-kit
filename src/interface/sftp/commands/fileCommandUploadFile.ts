// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_UPLOAD_FILE } from '../../../data/sftp/constants';
import { uploadFile } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_UPLOAD_FILE,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await uploadFile(ctx, { ignore: null });
  },
});
