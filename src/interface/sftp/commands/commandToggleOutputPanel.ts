// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_TOGGLE_OUTPUT } from '../../../data/sftp/constants';
import * as output from '../ui/output';
import { checkCommand } from './abstract/createCommand';

export default checkCommand({
  id: COMMAND_TOGGLE_OUTPUT,

  handleCommand() {
    output.toggle();
  },
});
