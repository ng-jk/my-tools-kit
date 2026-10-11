// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import * as path from 'path';
import debounce from 'lodash.debounce';
import logger from '../logger';
import { isValidFile, fileDepth } from '../helper/index';
import { upload, removeRemote } from '../fileHandlers/index';
import { WatcherService, TransferDirection } from '../../../logic/sftp/core/index';
import {reportAutomaticFailure} from './automaticFailure';
import { getFileService, getRunningTransformTasks } from './serviceManager/index';
import {isOwnLocalChange, localEntryExists} from '../../../data/sftp/local-events';
import {isTransferArtifact} from '../../../logic/sftp/core/staged-replacement';

const watchers: {
  [x: string]: vscode.FileSystemWatcher;
} = {};

import {handleCtxFromUri, FileHandlerContext} from '../fileHandlers/createFileHandler';
interface WatchEvent {uri:vscode.Uri; ctx:FileHandlerContext; current:()=>boolean;}
const uploadQueue = new Set<WatchEvent>();
const deleteQueue = new Set<WatchEvent>();

// less than 550 will not work
const ACTION_INTEVAL = 550;

function doUpload() {
  const files = Array.from(uploadQueue).sort((a, b) => fileDepth(b.uri.fsPath) - fileDepth(a.uri.fsPath));
  uploadQueue.clear();

  const currentDownloadTasks = getRunningTransformTasks().filter(
    task => task.transferType === TransferDirection.REMOTE_TO_LOCAL
  );

  files.forEach(async event => {
    if (!event.current()) return;
    const {uri,ctx}=event;
    if (isOwnLocalChange(uri.fsPath) || isTransferArtifact(uri.fsPath)) return;
    // current target is still in downloading, so don't upload it.
    if (currentDownloadTasks.find(task => task.localFsPath === uri.fsPath)) {
      return;
    }

    const fspath = uri.fsPath;
    logger.info(`[watcher/updated] ${fspath}`);
    const check=ctx.fileService.cancellationCheck();
    const attempt=async()=>{check();if(!event.current())throw new Error('Watcher context changed; retry from the current configuration');await upload(ctx);};
    try {
      await attempt();
    } catch (error) {
      await reportAutomaticFailure(ctx,'watcher upload',error,attempt);
    }
  });
}

function doDelete() {
  const files = Array.from(deleteQueue).sort((a, b) => fileDepth(b.uri.fsPath) - fileDepth(a.uri.fsPath));
  deleteQueue.clear();
  files.forEach(async event => {
    if (!event.current()) return;
    const {uri,ctx}=event;
    if (isOwnLocalChange(uri.fsPath) || isTransferArtifact(uri.fsPath) || localEntryExists(uri.fsPath)) return;
    const fspath = uri.fsPath;
    logger.info(`[watcher/removed] ${fspath}`);
    const check=ctx.fileService.cancellationCheck();
    const attempt=async(retry=false)=>{check();if(!event.current() || localEntryExists(uri.fsPath)){
      if(retry)throw new Error('Watcher context or local file changed; inspect before deleting');
      return; // Ignore an obsolete filesystem event, including an atomic replacement.
    }await removeRemote(ctx);};
    try {
      await attempt();
    } catch (error) {
      if (error.code==='ENOENT' || error.code===2) return; // Duplicate deletion event: destination is already absent.
      await reportAutomaticFailure(ctx,'watcher deletion',error,()=>attempt(true));
    }
  });
}

const debouncedUpload = debounce(doUpload, ACTION_INTEVAL, { leading: true, trailing: true });
const debouncedDelete = debounce(doDelete, ACTION_INTEVAL, { leading: true, trailing: true });

function uploadHandler(event: WatchEvent) {
  const {uri}=event;
  if (!isValidFile(uri) || isOwnLocalChange(uri.fsPath) || isTransferArtifact(uri.fsPath)) {
    return;
  }

  uploadQueue.add(event);
  debouncedUpload();
}

function addWatcher(id: string, watcher: vscode.FileSystemWatcher) {
  watchers[id] = watcher;
}

function getWatcher(id: string) {
  return watchers[id];
}

function createWatcher(
  watcherBase: string,
  watcherConfig: { files: false | string; autoUpload: boolean; autoDelete: boolean }
) {
  let watcher = getWatcher(watcherBase);
  if (watcher) {
    // clear old watcher
    watcher.dispose();
  }

  if (!watcherConfig) {
    return;
  }

  const shouldAddListenser = watcherConfig.autoUpload || watcherConfig.autoDelete;
  // tslint:disable-next-line triple-equals
  if (watcherConfig.files == false || !shouldAddListenser) {
    return;
  }

  watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(watcherBase, watcherConfig.files),
    false,
    false,
    false
  );
  addWatcher(watcherBase, watcher);

  const owner = getFileService(vscode.Uri.file(watcherBase));
  const thisWatcher = watcher;
  const bind = (uri:vscode.Uri):WatchEvent|undefined => {
    const current=()=>watchers[watcherBase]===thisWatcher && getFileService(uri)===owner;
    if (!owner || !current()) return; // A nested context owns its own automation policy.
    return {uri,ctx:handleCtxFromUri(uri),current};
  };
  if (watcherConfig.autoUpload) {
    const changed=(uri:vscode.Uri)=>{const event=bind(uri);if(event)uploadHandler(event);};
    watcher.onDidCreate(changed);
    watcher.onDidChange(changed);
  }

  if (watcherConfig.autoDelete) {
    watcher.onDidDelete(uri => {
      if (!isValidFile(uri) || isOwnLocalChange(uri.fsPath) || isTransferArtifact(uri.fsPath)) {
        return;
      }

      const event=bind(uri);if(!event)return;
      deleteQueue.add(event);
      debouncedDelete();
    });
  }
}

function removeWatcher(watcherBase: string) {
  for (const queue of [uploadQueue, deleteQueue]) {
    for (const event of queue) {
      const relative = path.relative(watcherBase, event.uri.fsPath);
      if (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) queue.delete(event);
    }
  }
  if (!uploadQueue.size) debouncedUpload.cancel();
  if (!deleteQueue.size) debouncedDelete.cancel();
  const watcher = getWatcher(watcherBase);
  if (watcher) {
    watcher.dispose();
    delete watchers[watcherBase];
  }
}

const watcherService: WatcherService = {
  create: createWatcher,
  dispose: removeWatcher,
};

export default watcherService;
