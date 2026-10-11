import {FileHandlerContext} from '../fileHandlers/createFileHandler';
import {FileType} from '../../../logic/sftp/core';
import {showConfirmMessage} from '../host';

export async function confirmListedDownload(ctx:FileHandlerContext,directory:boolean|undefined,force=false) {
  const check=ctx.fileService.cancellationCheck();
  check();
  const {config,target,fileService}=ctx;
  const entry=await (await fileService.getRemoteFileSystem(config)).lstat(target.remoteFsPath);
  if(directory===false && entry.type!==FileType.File)throw new Error('Download File requires a regular file. Use Download Folder for directories.');
  if(directory===true && entry.type!==FileType.Directory)throw new Error('Download Folder requires a directory. Use Download File for files.');
  if(directory===undefined)directory=entry.type===FileType.Directory;
  check();
  const message=`Download ${directory?'this folder recursively':'this file'} from ${fileService.name || config.host} (${config.host}:${config.port}, profile ${fileService.profile || 'base'}) ${target.remoteFsPath} to ${target.localFsPath}? Existing local files will be overwritten.${force?' Ignore rules will be bypassed.':''}`;
  if(!await showConfirmMessage(message,'Download','Cancel'))return false;
  check();
  return true;
}
