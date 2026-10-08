// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import {COMMAND_CREATE_FOLDER} from '../../../data/sftp/constants';
import {checkCommand} from './abstract/createCommand';
import {createRemoteEntry} from './createRemoteEntry';
export default checkCommand({id:COMMAND_CREATE_FOLDER,handleCommand(item,items){return createRemoteEntry(true,item,items);}});
