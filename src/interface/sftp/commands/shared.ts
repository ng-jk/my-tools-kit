// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as path from 'path';
import { Uri, window } from 'vscode';
import { FileType } from '../../../logic/sftp/core/index';
import { getAllFileService } from '../modules/serviceManager/index';
import { ExplorerItem } from '../modules/remoteExplorer/index';
import { getActiveTextEditor } from '../host';
import { listFiles, toLocalPath, simplifyPath } from '../helper/index';

function configIngoreFilterCreator(config: any) {
  if (!config || !config.ignore) {
    return;
  }

  return (file: { fsPath: string }) => !config.ignore(file.fsPath);
}

function createFileSelector(filterCreator?: (config: any) => ((file: any) => boolean) | undefined, type?: FileType) {
  return async (): Promise<Uri | undefined> => {
    const remoteItems = getAllFileService().map((fileService, index) => {
      const config = fileService.getConfig();
      return {
        name: config.name || config.remotePath,
        description: config.host,
        fsPath: config.remotePath,
        type: FileType.Directory,
        filter: filterCreator ? filterCreator(config) : undefined,
        getFs: () => fileService.getRemoteFileSystem(config),
        index,
        remoteBaseDir: config.remotePath,
        baseDir: fileService.baseDir,
      };
    });

    const selected = await listFiles(remoteItems, {type});

    if (!selected) {
      return;
    }

    const rootItem = remoteItems[selected.index];
    const localTarget = toLocalPath(selected.fsPath, rootItem.remoteBaseDir, rootItem.baseDir);

    return Uri.file(localTarget);
  };
}

export function selectContext(): Promise<Uri | undefined> {
  return new Promise((resolve, reject) => {
    const sercives = getAllFileService();
    const projectsList = sercives
      .map(service => ({
        value: service.baseDir,
        label: service.name || simplifyPath(service.baseDir),
        description: '',
        detail: service.baseDir,
      }))
      .sort((l, r) => l.label.localeCompare(r.label));

    // if (projectsList.length === 1) {
    // return resolve(projectsList[0].value);
    // }

    window
      .showQuickPick(projectsList, {
        placeHolder: 'Select a folder...',
      })
      .then(selection => {
        if (selection) {
          return resolve(Uri.file(selection.value));
        }

        // cancel selection
        resolve();
      }, reject);
  });
}

export function applySelector<T>(...selectors: ((...args: any[]) => T | Promise<T>)[]) {
  return function combinedSelector(...args: any[]): T | Promise<T> {
    let result;
    for (const selector of selectors) {
      result = selector.apply(this, args);
      if (result) {
        break;
      }
    }

    return result;
  };
}

export function uriFromfspath(fileList: string[]): Uri[] | undefined {
  if (!Array.isArray(fileList) || typeof fileList[0] !== 'string') {
    return;
  }

  return fileList.map(file => Uri.file(file));
}

export function getActiveDocumentUri() {
  const active = getActiveTextEditor();
  if (!active || !active.document) {
    return;
  }

  return active.document.uri;
}

export function getActiveFolder() {
  const uri = getActiveDocumentUri();
  if (!uri) {
    return;
  }

  return Uri.file(path.dirname(uri.fsPath));
}

// selected file or activeTarget or configContext
export async function uriFromExplorerContextOrEditorContext(item?: any, items?: any): Promise<undefined | Uri | Uri[]> {
  // from explorer or editor context
  if ((item && typeof item.scheme === 'string' && typeof item.fsPath === 'string')) {
    if (Array.isArray(items) && (items[0] && typeof items[0].scheme === 'string' && typeof items[0].fsPath === 'string')) {
      // multi-select in explorer
      return items;
    } else {
      return item;
    }
  } else if (item && (item as ExplorerItem).resource) {
    // from remote explorer
    if (Array.isArray(items) && items[0] && (items[0] as ExplorerItem).resource) {
      // multi-select in remote explorer
      return items.map((_: any) => _.resource.uri);
    } else {
      return item.resource.uri;
    }
  }

  const active = getActiveDocumentUri();
  if (active && (active.scheme === 'file' || active.scheme === 'devkit-sftp')) return active;
  return window.showOpenDialog({canSelectFiles: true, canSelectFolders: true, canSelectMany: true,
    openLabel: 'Select SFTP target'});
}

export async function selectRemoteTarget(item?: any, items?: any): Promise<undefined | Uri | Uri[]> {
  if (item || getActiveDocumentUri()) return uriFromExplorerContextOrEditorContext(item, items);
  return selectFileFromAll();
}

// selected folder or configContext
export function selectFolderFallbackToConfigContext(item: any, items: any): Promise<undefined | Uri | Uri[]> {
  // from explorer or editor context
  if (item) {
    if ((item && typeof item.scheme === 'string' && typeof item.fsPath === 'string')) {
      if (Array.isArray(items) && (items[0] && typeof items[0].scheme === 'string' && typeof items[0].fsPath === 'string')) {
        // multi-select in explorer
        return Promise.resolve(items);
      } else {
        return Promise.resolve(item);
      }
    } else if (item && (item as ExplorerItem).resource) {
      // from remote explorer
      return Promise.resolve(item.resource.uri);
    }
  }

  return selectContext();
}

// selected file from all remote files
export const selectFileFromAll = createFileSelector();

// selected file from remote files expect ignored
export const selectFile = createFileSelector(configIngoreFilterCreator);

export async function selectLocalFolder(item?: any, items?: any): Promise<undefined | Uri | Uri[]> {
  if (item) return uriFromExplorerContextOrEditorContext(item, items);
  return window.showOpenDialog({canSelectFiles: false, canSelectFolders: true, canSelectMany: true, openLabel: 'Select folder to upload'});
}
export async function selectRemoteFolder(item?: any, items?: any): Promise<undefined | Uri | Uri[]> {
  if (item) return uriFromExplorerContextOrEditorContext(item, items);
  return createFileSelector(undefined, FileType.Directory)();
}
export const selectRemoteFileOnly = createFileSelector(undefined, FileType.File);
