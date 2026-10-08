// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as path from 'path';
import {confirmListedDownload} from './confirmListedDownload';
import { COMMAND_LIST_ACTIVEFOLDER } from '../../../data/sftp/constants';
import { showTextDocument } from '../host';
import { FileType, UResource } from '../../../logic/sftp/core/index';
import { downloadFile, downloadFolder } from '../fileHandlers/index';
import { checkCommand } from './abstract/createCommand';
import { getActiveFolder } from './shared';
import { handleCtxFromUri } from '../fileHandlers/index';
import { listFiles } from '../helper/index';

export default checkCommand({
  id: COMMAND_LIST_ACTIVEFOLDER,

  async handleCommand() {
    const folderUri = getActiveFolder();
    if (!folderUri) {
      return;
    }

    const ctx = handleCtxFromUri(folderUri);
    const config = ctx.config;
    const remotefs = await ctx.fileService.getRemoteFileSystem(config);
    const fileEntry = await remotefs.list(ctx.target.remoteFsPath);
    const filter = config.ignore ? (file: any) => !config.ignore!(file.fsPath, 'remote') : undefined;

    const listItems = fileEntry.map(file => ({
      name: path.basename(file.fspath) + (file.type === FileType.Directory ? '/' : ''),
      fsPath: file.fspath,
      type: file.type,
      description: '',
      getFs: remotefs,
      filter,
    }));
    const selected = await listFiles(listItems);
    if (!selected) {
      return;
    }

    const remoteUri = UResource.makeResource({fsPath:selected.fsPath, remoteId:ctx.fileService.id,
      remote:{host:config.host,port:config.port}}).uri;
    const selectedCtx=handleCtxFromUri(remoteUri);
    if(!await confirmListedDownload(selectedCtx,selected.type===FileType.Directory))return;
    if (selected.type !== FileType.Directory) {
      await downloadFile(selectedCtx);
      try {
        await showTextDocument(handleCtxFromUri(remoteUri).target.localUri);
      } catch (error) {
        // ignore
      }
    } else {
      await downloadFolder(selectedCtx);
    }
  },
});
