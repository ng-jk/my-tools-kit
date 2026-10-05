// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_DELETE_REMOTE } from '../../../data/sftp/constants';
import { upath, UResource } from '../../../logic/sftp/core/index';
import { removeRemote } from '../fileHandlers/index';
import { showConfirmMessage } from '../host';
import { checkFileCommand } from './abstract/createCommand';
import { selectRemoteTarget } from './shared';

export default checkFileCommand({
  id: COMMAND_DELETE_REMOTE,
  async getFileTarget(item, items) {
    const targets = await selectRemoteTarget(item, items);

    if (!targets) {
      return;
    }

    const filename = Array.isArray(targets)
      ? targets.map(t => upath.basename(UResource.makeResource(t).fsPath)).join(',')
      : upath.basename(UResource.makeResource(targets).fsPath);
    const result = await showConfirmMessage(
      `Are you sure you want to delete '${filename}'?`,
      'Delete',
      'Cancel'
    );

    return result ? targets : undefined;
  },

  handleFile: removeRemote,
});
