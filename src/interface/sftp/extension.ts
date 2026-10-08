import { configurePorts } from '../../data/sftp/ports';
import logger from './logger';
// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import app from './app';
import initCommands from './initCommands';
import { reportError } from './helper/index';
import fileActivityMonitor from './modules/fileActivityMonitor';
import { tryLoadConfigs } from './modules/config';
import { getAllFileService, createFileServices, disposeFileService } from './modules/serviceManager/index';
import { getWorkspaceFolders, setContextValue } from './host';
import RemoteExplorer from './modules/remoteExplorer/index';

async function setupWorkspaceFolder(dir: string) {
  const configs = await tryLoadConfigs(dir);
  createFileServices(configs,dir);
}

function setup(workspaceFolders: vscode.WorkspaceFolder[]) {
  fileActivityMonitor.init();
  const pendingInits = workspaceFolders.map(folder => setupWorkspaceFolder(folder.uri.fsPath).catch(error => reportError(error)));

  return Promise.all(pendingInits);
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  if (!vscode.workspace.isTrusted) return;
  configurePorts({ settings: (section: string) => vscode.workspace.getConfiguration(section), password: (prompt: string) => vscode.window.showInputBox({prompt, password:true, ignoreFocusOut:true}), documents: () => vscode.workspace.textDocuments, log: (level: string, ...args: any[]) => logger[level](...args) });
  try {
    initCommands(context);
  } catch (error) {
    reportError(error, 'initCommands');
  }

  const workspaceFolders = getWorkspaceFolders() || [];

  setContextValue('enabled', true);
  setContextValue('hasConfiguration', false);
  app.sftpBarItem.show();
  app.state.subscribe((_: any) => {
    const currentText = app.sftpBarItem.getText();
    // current is showing profile
    if (currentText.startsWith('SFTP')) {
      app.sftpBarItem.reset();
    }
    if (app.remoteExplorer) {
      app.remoteExplorer.refresh();
    }
  });
  try {
    app.remoteExplorer = new RemoteExplorer(context);
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(async event => {
      for (const folder of event.removed) {
        getAllFileService().filter(service => service.workspace === folder.uri.fsPath).forEach(disposeFileService);
      }
      await Promise.all(event.added.map(folder => setupWorkspaceFolder(folder.uri.fsPath).catch(error => reportError(error))));
      app.remoteExplorer.refresh();
    }));
    await setup(workspaceFolders);
    app.remoteExplorer.refresh();
  } catch (error) {
    reportError(error);
  }
}

export function deactivate() {
  fileActivityMonitor.destory();
  getAllFileService().forEach(disposeFileService);
  app.sftpBarItem.dispose();
}
