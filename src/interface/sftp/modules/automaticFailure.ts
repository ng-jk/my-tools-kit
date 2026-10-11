import {window} from 'vscode';
import {FileHandlerContext} from '../fileHandlers/createFileHandler';
import app from '../app';
import StatusBarItem from '../ui/statusBarItem';
import logger from '../logger';
import * as output from '../ui/output';

export async function reportAutomaticFailure(ctx:FileHandlerContext, operation:string, error:unknown, retry:()=>Promise<unknown>) {
  const check=ctx.fileService.cancellationCheck();
  const destination=`${ctx.config.host}:${ctx.config.port}, profile ${ctx.fileService.profile || 'base'}: ${ctx.target.localFsPath} ↔ ${ctx.target.remoteFsPath}`;
  for (;;) {
    logger.error(error, `automatic ${operation}: ${destination}`);
    app.sftpBarItem.showMsg(`Automatic ${operation} failed: ${ctx.target.localFsPath}`,destination);
    app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
    const action=await window.showErrorMessage(`Automatic ${operation} failed (${destination}). Completion is not confirmed. Check the output and connection, then retry.`, 'Show details', 'Retry', 'Dismiss');
    if(action==='Show details'){output.show();return;}
    if(action!=='Retry')return;
    try {check();await retry();app.sftpBarItem.updateStatus(StatusBarItem.Status.ok);app.sftpBarItem.showMsg(`Automatic ${operation} retry completed`,destination,4000);await window.showInformationMessage(`Automatic ${operation} retry completed (${destination}).`);return;}
    catch(next){error=next;}
  }
}
