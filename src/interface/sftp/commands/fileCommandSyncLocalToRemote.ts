// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_SYNC_LOCAL_TO_REMOTE } from '../../../data/sftp/constants';
import { sync2Remote } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { selectFolderFallbackToConfigContext, uriFromfspath, applySelector } from './shared';

export default checkFileCommand({
  id: COMMAND_SYNC_LOCAL_TO_REMOTE,
  getFileTarget: applySelector(uriFromfspath, selectFolderFallbackToConfigContext),

  handleFile: sync2Remote,
});
