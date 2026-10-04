// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { COMMAND_CREATE_FILE } from '../../../data/sftp/constants';
import { createRemoteFile } from '../fileHandlers/index';
// import { showConfirmMessage } from '../host';
import { checkFileCommand } from './abstract/createCommand';
import { selectFolderFallbackToConfigContext } from './shared';
import { window, Uri } from 'vscode';

export default checkFileCommand({
  id: COMMAND_CREATE_FILE,
  async getFileTarget(item, items) {
    const targets = await selectFolderFallbackToConfigContext(item, items);

    if (!targets) {
      return;
    }
   /* const filename = Array.isArray(targets)
    ? targets.map(t => upath.basename(t.fsPath)).join(',')
    : upath.basename(targets.fsPath);
*/
    const result = await window.showInputBox({
        value: '',
        prompt: 'Please input file name',
    });


    if (result !== undefined) {
        // window.showInformationMessage(targets.toString() + '%252F' + result);

        if (Array.isArray(targets)) throw new Error('Select one destination folder');
        if (!result || /[\\/]/.test(result) || result === '.' || result === '..') throw new Error('Enter a single file or folder name');
        return Uri.joinPath(targets, result);
    }


    return undefined;

/*
    const filename = Array.isArray(targets)
      ? targets.map(t => upath.basename(t.fsPath)).join(',')
      : upath.basename(targets.fsPath);
    const result = await showConfirmMessage(
      `Are you sure you want to delete '${filename}'?`,
      'Delete',
      'Cancel'
    );

    return result ? targets : undefined;*/
  },

  handleFile: createRemoteFile,
});
