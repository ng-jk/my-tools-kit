// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { UResource } from '../../../logic/sftp/core/index';
import app from '../app';
import { COMMAND_REVEAL_IN_REMOTE_EXPLORER } from '../../../data/sftp/constants';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_REVEAL_IN_REMOTE_EXPLORER,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile({ target }) {
    await app.remoteExplorer.reveal({
      resource: UResource.makeResource(target.remoteUri),
      isDirectory: false,
    });
  },
});
