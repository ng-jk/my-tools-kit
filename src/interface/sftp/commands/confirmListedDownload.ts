import {FileHandlerContext} from '../fileHandlers/createFileHandler';
import {showConfirmMessage} from '../host';

export async function confirmListedDownload(ctx:FileHandlerContext,directory:boolean,force=false) {
  const check=ctx.fileService.cancellationCheck();
  check();
  const {config,target,fileService}=ctx;
  const message=`Download ${directory?'this folder recursively':'this file'} from ${fileService.name || config.host} (${config.host}:${config.port}, profile ${fileService.profile || 'base'}) ${target.remoteFsPath} to ${target.localFsPath}? Existing local files will be overwritten.${force?' Ignore rules will be bypassed.':''}`;
  if(!await showConfirmMessage(message,'Download','Cancel'))return false;
  check();
  return true;
}
