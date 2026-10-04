// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { getUserSetting } from '../host';
import { EXTENSION_NAME } from '../../../data/sftp/constants';

export function getExtensionSetting() {
  return getUserSetting(EXTENSION_NAME);
}
