// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import LRU = require('lru-cache');
import StatusBarItem from './ui/statusBarItem';
import { COMMAND_TOGGLE_OUTPUT } from '../../data/sftp/constants';
import AppState from './modules/appState';
import RemoteExplorer from './modules/remoteExplorer/index';

interface App {
  fsCache: LRU.Cache<string, string>;
  state: AppState;
  sftpBarItem: StatusBarItem;
  remoteExplorer: RemoteExplorer;
}

import shared from '../../data/sftp/ports';
const app: App = shared;

app.state = new AppState();
app.sftpBarItem = new StatusBarItem(
  () => {
    if (app.state.profile) {
      return `SFTP: ${app.state.profile}`;
    } else {
      return 'SFTP';
    }
  },
  'SFTP@ng-jk',
  COMMAND_TOGGLE_OUTPUT
);
app.fsCache = LRU<string, string>({ max: 6 });

export default app;
