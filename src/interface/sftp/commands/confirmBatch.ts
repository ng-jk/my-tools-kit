import {window} from 'vscode';
import {FileHandlerContext} from '../fileHandlers/createFileHandler';

export async function confirmBatch(entries: Array<{ctx:FileHandlerContext; description:string}>) {
  if (!entries.length) return false;
  if(entries.every(entry=>/^upload/i.test(entry.description)))return true;
  const detail = entries.map(({ctx,description}) => `${description}\n${ctx.fileService.name || ctx.config.host} — profile ${ctx.fileService.profile || 'base'} (${ctx.config.host}:${ctx.config.port})\n${ctx.target.localFsPath} → ${ctx.target.remoteFsPath}`).join('\n\n');
  return await window.showInformationMessage('Apply these Git transfers?', {modal:true,
    detail:`Uploads overwrite remote files. Listed remote deletions or renames also modify the server. Uploads are backed up automatically. Deletions and renames require this confirmation. Cancel applies no changes.\n\n${detail}`
  }, 'Apply changes', 'Cancel') === 'Apply changes';
}
