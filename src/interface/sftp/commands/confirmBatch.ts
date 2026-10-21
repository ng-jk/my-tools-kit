import {window} from 'vscode';
import logger from '../logger';
import * as output from '../ui/output';
import {FileHandlerContext} from '../fileHandlers/createFileHandler';

export async function confirmBatch(entries: Array<{ctx:FileHandlerContext; description:string}>) {
  if (!entries.length) return false;
  const detail = entries.map(({ctx,description}) => `${description}\n${ctx.fileService.name || ctx.config.host} — profile ${ctx.fileService.profile || 'base'} (${ctx.config.host}:${ctx.config.port})\n${ctx.target.localFsPath} → ${ctx.target.remoteFsPath}`).join('\n\n');
  if(entries.every(entry=>/^upload/i.test(entry.description))){
    logger.info('Git upload scope: current local contents. Commit selections choose filenames only.');
    logger.info(detail);output.show(true);return true;
  }
  return await window.showInformationMessage('Apply these Git transfers?', {modal:true,
    detail:`Uploads overwrite remote files. Listed remote deletions or renames also modify the server. Uploads are backed up automatically. Deletions and renames require this confirmation. Cancel applies no changes.\n\n${detail}`
  }, 'Apply changes', 'Cancel') === 'Apply changes';
}
