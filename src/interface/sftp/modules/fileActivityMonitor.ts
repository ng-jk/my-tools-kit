// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import * as path from 'path';
import {handleCtxFromUri} from '../fileHandlers/createFileHandler';
import logger from '../logger';
import { nativeRealpath } from '../../../data/sftp/local-path';
import app from '../app';
import StatusBarItem from '../ui/statusBarItem';
import { onDidOpenTextDocument, onDidSaveTextDocument, showConfirmMessage } from '../host';
import { getFileService, reloadWorkspaceServices } from './serviceManager/index';
import { isValidFile, isConfigFile, isInWorkspace } from '../helper/index';
import { downloadFile, uploadFile } from '../fileHandlers/index';

let workspaceWatcher: vscode.Disposable;
let openWatcher: vscode.Disposable;

async function handleConfigSave(uri: vscode.Uri) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return;
  }

  // Recreate services from the saved config (honors defaultProfile as before).
  await reloadWorkspaceServices(workspaceFolder.uri.fsPath);
}

async function handleFileSave(uri: vscode.Uri) {
  const fileService = getFileService(uri);
  if (!fileService) {
    return;
  }

  const config = fileService.getConfig();
  if (config.uploadOnSave) {
    const ctx=handleCtxFromUri(uri),check=ctx.fileService.cancellationCheck();
    const fspath=uri.fsPath;
    try {
      const resolved=await nativeRealpath(fspath);
      check();
      if(path.relative(fspath,resolved)!=='' || getFileService(vscode.Uri.file(resolved))!==fileService) throw new Error('Automatic upload cannot follow a symlink or change context');
      logger.info(`[file-save] ${fspath}`);
      await uploadFile(ctx);
    } catch (error) {
      logger.error(error, `upload ${fspath}`);
      app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
    }
  }
}

async function downloadOnOpen(uri: vscode.Uri) {
  const fileService = getFileService(uri);
  if (!fileService) {
    return;
  }

  const config = fileService.getConfig();
  if (config.downloadOnOpen) {
    const ctx=handleCtxFromUri(uri),check=ctx.fileService.cancellationCheck();
    const fspath=uri.fsPath;
    try {
      if(config.downloadOnOpen==='confirm') {
        const message=`Download from ${ctx.fileService.name || config.host} (${config.host}:${config.port}, profile ${ctx.fileService.profile || 'base'}) ${ctx.target.remoteFsPath} and overwrite ${ctx.target.localFsPath}?`;
        if(!await showConfirmMessage(message,'Download','Cancel'))return;
      }
      check();
      logger.info(`[file-open] ${fspath}`);
      await downloadFile(ctx);
    } catch (error) {
      logger.error(error, `download ${fspath}`);
      app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
    }
  }
}

function watchWorkspace({
  onDidSaveFile,
  onDidSaveSftpConfig,
}: {
  onDidSaveFile: (uri: vscode.Uri) => void;
  onDidSaveSftpConfig: (uri: vscode.Uri) => void;
}) {
  if (workspaceWatcher) {
    workspaceWatcher.dispose();
  }

  workspaceWatcher = onDidSaveTextDocument((doc: vscode.TextDocument) => {
    const uri = doc.uri;
    if (!isValidFile(uri) || !isInWorkspace(uri.fsPath)) {
      return;
    }

    // remove staled cache
    if (app.fsCache.has(uri.fsPath)) {
      app.fsCache.del(uri.fsPath);
    }

    if (isConfigFile(uri)) {
      return onDidSaveSftpConfig(uri);
    }

    return onDidSaveFile(uri);
  });
}

function init() {
  openWatcher?.dispose();
  openWatcher = onDidOpenTextDocument((doc: vscode.TextDocument) => {
    if (!isValidFile(doc.uri) || !isInWorkspace(doc.uri.fsPath)) {
      return;
    }

    return downloadOnOpen(doc.uri);
  });

  watchWorkspace({
    onDidSaveFile: handleFileSave,
    onDidSaveSftpConfig: handleConfigSave,
  });
}

function destory() {
  openWatcher?.dispose();
  if (workspaceWatcher) {
    workspaceWatcher.dispose();
  }
}

export default {
  init,
  destory,
};
