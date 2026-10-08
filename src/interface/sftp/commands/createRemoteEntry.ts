import * as path from 'path';
import {window} from 'vscode';
import {assertEntryName} from '../../../data/sftp/path-safety';
import {UResource} from '../../../logic/sftp/core';
import {selectFolderFallbackToConfigContext} from './shared';
import {handleCtxFromUri} from '../fileHandlers/createFileHandler';
import {createRemoteFile, createRemoteFolder} from '../fileHandlers';

export async function createRemoteEntry(folder: boolean, item?: any, items?: any) {
  const target = await selectFolderFallbackToConfigContext(item, items);
  if (!target) return;
  if (Array.isArray(target)) throw new Error('Select one destination folder');
  const parent = handleCtxFromUri(target);
  const check = parent.fileService.cancellationCheck();
  const validateInput = (value: string) => {
    try {assertEntryName(value);return undefined;} catch {return 'Enter one valid file or folder name, without path separators or reserved names';}
  };
  let value = '';
  while (true) {
    const name = await window.showInputBox({value, prompt:`New ${folder?'folder':'file'} in ${parent.config.host}: ${parent.target.remoteFsPath}`, validateInput});
    if (name === undefined) return;
    value = name;
    if (validateInput(name)) continue;
    check();
    const uri = UResource.updateResource(UResource.makeResource(parent.target.remoteUri),
      {remotePath:path.posix.join(parent.target.remoteFsPath,name)}).uri;
    try {
      const ctx = handleCtxFromUri(uri);
      if (ctx.config.ignore?.(ctx.target.remoteFsPath, 'remote')) throw new Error('This name is excluded by the active context ignore rules; choose another name or edit the configuration');
      await (folder ? createRemoteFolder(ctx) : createRemoteFile(ctx));
      return;
    } catch (error) {
      const retry = await window.showErrorMessage(`Could not create ${name}: ${error instanceof Error?error.message:String(error)}`, 'Retry', 'Cancel');
      if (retry !== 'Retry') return;
    }
  }
}
