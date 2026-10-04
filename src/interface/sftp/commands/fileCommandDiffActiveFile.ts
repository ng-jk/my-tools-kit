// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_DIFF_ACTIVEFILE } from '../../../data/sftp/constants';
import { diff } from '../fileHandlers/index';
import { checkFileCommand } from './abstract/createCommand';
import { getActiveDocumentUri } from './shared';

export default checkFileCommand({
  id: COMMAND_DIFF_ACTIVEFILE,
  getFileTarget: getActiveDocumentUri,
  handleFile: diff,
});
