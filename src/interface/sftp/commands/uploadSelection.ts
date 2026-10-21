import {window} from 'vscode';
import {FileType} from '../../../logic/sftp/core';
import {FileHandlerContext, upload} from '../fileHandlers';

export async function uploadSelection(ctx: FileHandlerContext, kind: 'file' | 'folder' | 'any', force = false) {
  const {fileService, config, target} = ctx;
  const check = fileService.cancellationCheck();
  check();
  const entry = await fileService.getLocalFileSystem().lstat(target.localFsPath);
  if (kind === 'file' && entry.type !== FileType.File) throw new Error('Upload File requires a regular file. Use Upload Folder for directories.');
  if (kind === 'folder' && entry.type !== FileType.Directory) throw new Error('Upload Folder requires a directory. Use Upload File for files.');
  if (!force && config.ignore && config.ignore(target.localFsPath, 'local')) {
    if (!ctx.transient) await window.showInformationMessage(`Skipped excluded upload: ${target.localFsPath}. Review your ignore rules before using Force Upload.`);
    return;
  }
  if(force&&!ctx.transient){
    const answer=await window.showInformationMessage('Force Upload bypasses credential-file exclusions.',{modal:true,detail:'Ignore rules will be bypassed, including credential-file exclusions. '+`${fileService.name||config.host} - profile ${fileService.profile||'base'} (${config.host}:${config.port})\n${target.localFsPath} -> ${target.remoteFsPath}`},'Upload');
    if(answer!=='Upload')return;
  }
  check();
  await upload(ctx, {...(force ? {ignore: null} : {}), expectedSourceType:kind==='any'?undefined:kind==='folder'?'directory':'file'});
}
