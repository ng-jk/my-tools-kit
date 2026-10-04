// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_CANCEL_ALL_TRANSFER } from '../../../data/sftp/constants';
import { checkCommand } from './abstract/createCommand';
import {cancelActiveTransfers} from '../../../logic/sftp/transfer-operation';
import { findAllFileService } from '../modules/serviceManager/index';

export default checkCommand({
  id: COMMAND_CANCEL_ALL_TRANSFER,

  async handleCommand() {
    cancelActiveTransfers();
    findAllFileService(f => f.isTransferring()).forEach(f => f.cancelTransferTasks());
  },
});
