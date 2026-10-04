// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import { COMMAND_OPEN_CONNECTION_IN_TERMINAL } from '../../../data/sftp/constants';
import { getAllFileService } from '../modules/serviceManager/index';
import { ExplorerRoot } from '../modules/remoteExplorer/index';
import { interpolate } from '../../../logic/sftp/utils';
import { checkCommand } from './abstract/createCommand';

import { sshArguments } from '../../../logic/sftp/ssh-arguments';

export default checkCommand({
  id: COMMAND_OPEN_CONNECTION_IN_TERMINAL,

  async handleCommand(exploreItem?: ExplorerRoot) {
    let remoteConfig;
    if (exploreItem && exploreItem.explorerContext) {
      remoteConfig = exploreItem.explorerContext.config;
      if (remoteConfig.protocol !== 'sftp') {
        return;
      }
    } else {
      const remoteItems = getAllFileService().reduce<
        { label: string; description: string; config: any }[]
      >((result, fileService) => {
        const config = fileService.getConfig();
        if (config.protocol === 'sftp') {
          result.push({
            label: config.name || config.remotePath,
            description: config.host,
            config,
          });
        }
        return result;
      }, []);
      if (remoteItems.length <= 0) {
        return;
      }

      const item = await vscode.window.showQuickPick(remoteItems, {
        placeHolder: 'Select a folder...',
      });
      if (item === undefined) {
        return;
      }

      remoteConfig = item.config;
    }

    const terminal = vscode.window.createTerminal({name: remoteConfig.name || 'SFTP SSH', shellPath: 'ssh', shellArgs: sshArguments(remoteConfig)});
    terminal.show();
  },
});
