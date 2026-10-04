// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_FORCE_DOWNLOAD } from '../../../data/sftp/constants';
import { download } from '../fileHandlers/index';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_FORCE_DOWNLOAD,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await download(ctx, { ignore: null });
  },
});
