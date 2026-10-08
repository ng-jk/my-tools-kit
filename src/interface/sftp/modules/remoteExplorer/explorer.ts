// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import { registerCommand } from '../../host';
import { selectRemoteFileOnly } from '../../commands/shared';
import {
  COMMAND_REMOTEEXPLORER_REFRESH,
  COMMAND_REMOTEEXPLORER_REFRESH_ACTIVE_FILE,
  COMMAND_REMOTEEXPLORER_VIEW_CONTENT,
} from '../../../../data/sftp/constants';
import { UResource } from '../../../../logic/sftp/core/index';
import { toRemotePath } from '../../helper/index';
import { REMOTE_SCHEME } from '../../../../data/sftp/constants';
import { getFileService } from '../serviceManager/index';
import RemoteTreeDataProvider, { ExplorerItem } from './treeDataProvider';

export default class RemoteExplorer {
  private _explorerView: vscode.TreeView<ExplorerItem>;
  private _treeDataProvider: RemoteTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    this._treeDataProvider = new RemoteTreeDataProvider();
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(REMOTE_SCHEME, this._treeDataProvider)
    );

    this._explorerView = vscode.window.createTreeView('devkit.remoteExplorer', {
      showCollapseAll: true,
      treeDataProvider: this._treeDataProvider,
      canSelectMany: true,
    });

    registerCommand(context, COMMAND_REMOTEEXPLORER_REFRESH, () => this._refreshSelection());
    registerCommand(context, COMMAND_REMOTEEXPLORER_REFRESH_ACTIVE_FILE, () => this._refreshActiveRemoteFile());
    registerCommand(context, COMMAND_REMOTEEXPLORER_VIEW_CONTENT, async (item?: ExplorerItem) => {
      item = item || this._explorerView.selection[0];
      if (!item) {
        const uri = await selectRemoteFileOnly();
        if (!uri) return;
        const service = getFileService(uri);
        if (!service) throw new Error('No SFTP configuration for the selected file');
        item = {resource: UResource.makeResource(uri), isDirectory:false} as ExplorerItem;
      }
      return this._treeDataProvider.showItem(item);
    });
  }

  refresh(item?: ExplorerItem) {
    if (item && !UResource.isRemote(item.resource.uri)) {
      const uri = item.resource.uri;
      const fileService = getFileService(uri);
      if (!fileService) {
        if (uri.toString(true) == "file:///${command:devkit.sftp.sync.remoteToLocal}") {
          throw '';
        } else {
          throw new Error(`Config Not Found. (${uri.toString(true)})`);
        }
      }
      const config = fileService.getConfig();
      const localPath = item.resource.fsPath;
      const remotePath = toRemotePath(localPath, config.context, config.remotePath);
      item.resource = UResource.makeResource({
        remote: {
          host: config.host,
          port: config.port,
        },
        fsPath: remotePath,
        remoteId: fileService.id,
      });
    }

    this._treeDataProvider.refresh(item);
  }

  reveal(item: ExplorerItem): Thenable<void> {
    return item ? this._explorerView.reveal(item) : Promise.resolve();
  }

  findRoot(remoteUri: vscode.Uri) {
    return this._treeDataProvider.findRoot(remoteUri);
  }

  private _refreshSelection() {
    if (this._explorerView.selection.length) {
      this._explorerView.selection.forEach(item => this.refresh(item));
    } else {
      this.refresh();
    }
  }

  private _refreshActiveRemoteFile() {
    const focusedEditor = vscode.window.activeTextEditor;
    if (focusedEditor) {

      const remoteFileUri = focusedEditor.document.uri;
      const root = this._treeDataProvider.findRoot(remoteFileUri);
      const incompleteResource = UResource.makeResource(remoteFileUri);

      if (!root) {
        return;
      }
      const remoteFileItem = {
        resource: UResource.updateResource(root.resource, {
          remotePath: incompleteResource.fsPath
        }),
        isDirectory: false
      };

      this.refresh(remoteFileItem);
    }

  }
}
