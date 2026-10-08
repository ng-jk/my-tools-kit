// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { Uri } from 'vscode';
import * as path from 'path';
import app from '../../app';
import logger from '../../logger';
import { simplifyPath, reportError } from '../../helper/index';
import { UResource, FileService, TransferTask } from '../../../../logic/sftp/core/index';
import { resolveProfileContext } from '../../../../logic/sftp/core/profileContext';
import { validateConfig, readConfigsFromFile } from '../config';
import { CONFIG_PATH } from '../../../../data/sftp/constants';
import watcherService from '../fileWatcher';
import Trie from './trie';
import {setContextValue} from '../../host';

const WIN_DRIVE_REGEX = /^([a-zA-Z]):/;
const isWindows = process.platform === 'win32';

const serviceManager = new Trie<FileService>(
  {},
  {
    delimiter: path.sep,
  }
);

function maskConfig(config: { [key: string]: any }) {
  const copy: { [key: string]: any } = {};
  const MASK = '******';
  Object.keys(config).forEach(key => {
    const configValue = config[key];
    switch (key) {
      case 'username':
      case 'password':
      case 'passphrase':
      case 'privateKey':
      case 'key':
      case 'pfx':
        copy[key] = MASK;
        break;
      case 'interactiveAuth':
        if (Array.isArray(configValue)) {
          copy[key] = configValue.map((phrase: any) => MASK);
        } else {
          copy[key] = configValue;
        }
        break;
      default:
        copy[key] = Array.isArray(configValue) ? configValue.map(item => item && typeof item === 'object' ? maskConfig(item) : item)
          : configValue && typeof configValue === 'object' ? maskConfig(configValue) : configValue;
    }
  });
  return copy;
}

function normalizePathForTrie(pathname: string) {
  if (isWindows) {
    const device = pathname.substr(0, 2);
    if (device.charAt(1) === ':') {
      // lowercase drive letter
      pathname = pathname[0].toLowerCase() + pathname.substr(1);
    }
  }

  return path.normalize(pathname);
}

export function getBasePath(context: string | undefined, workspace: string) {
  let dirpath;
  if (context) {
    if (path.isAbsolute(context)) {
      dirpath = context;
      if (isWindows) {
        const contextBeginWithDrive = context.match(WIN_DRIVE_REGEX);
        // if a windows user omit drive, we complete it with a drive letter same with the workspace one
        if (!contextBeginWithDrive) {
          const workspaceDrive = workspace.match(WIN_DRIVE_REGEX);
          if (workspaceDrive) {
            const drive = workspaceDrive[1];
            dirpath = path.join(`${drive}:`, context);
          }
        }
      }
    } else {
      // Don't use path.resolve bacause it may change the root dir of workspace!
      // Example: On window path.resove('\\a\\b\\c') will result to '<drive>:\\a\\b\\c'
      // We know workspace must be a absolute path and context is a relative path to workspace,
      // so path.join will suit our requirements.
      dirpath = path.join(workspace, context);
    }
  } else {
    dirpath = workspace;
  }

  return normalizePathForTrie(dirpath);
}

export function createFileService(
  config: any,
  workspace: string,
  options: { preserveProfile?: boolean; profile?: string | null } = {}
) {
  // Capture selection per service; creating another config must not retarget it.
  const requested = options.profile !== undefined ? options.profile : options.preserveProfile ? app.state.profile : config.defaultProfile || null;
  const selected = requested && config.profiles && !config.profiles[requested] ? config.defaultProfile || null : requested;
  const normalizedBasePath = getBasePath(resolveProfileContext(config, selected), workspace);
  if(getAllFileService().some(service=>service.baseDir===normalizedBasePath)) throw new Error('Duplicate SFTP local context: '+normalizedBasePath+'. Use distinct contexts or named contexts with one active selection.');
  const service = new FileService(normalizedBasePath, workspace, config, selected);

  logger.info(`config at ${normalizedBasePath}`, maskConfig(config));

  serviceManager.add(normalizedBasePath, service);
  setContextValue('hasConfiguration', true);
  service.name = config.name;
  service.setConfigValidator(validateConfig);
  service.setWatcherService(watcherService);
  service.beforeTransfer((task: TransferTask) => {
    const { localFsPath, transferType } = task;
    app.sftpBarItem.showMsg(
      `${transferType} ${path.basename(localFsPath)}`,
      simplifyPath(localFsPath)
    );
  });
  service.afterTransfer((error: Error | null, task: TransferTask) => {
    const { localFsPath, transferType } = task;
    const filename = path.basename(localFsPath);
    const filepath = simplifyPath(localFsPath);
    if (task.isCancelled()) {
      logger.info(`cancel transfer ${localFsPath}`);
      app.sftpBarItem.showMsg(`cancelled ${filename}`, filepath, 2000 * 2);
    } else if (error) {
      // if ((error as any).reported !== true) {
      reportError(error, `when ${transferType} ${localFsPath}`);
      // }
      app.sftpBarItem.showMsg(`failed ${filename}`, filepath, 2000 * 2);
    } else {
      logger.info(`${transferType} ${localFsPath}`);
      app.sftpBarItem.showMsg(`done ${filename}`, filepath, 2000 * 2);
    }
  });

  return service;
}

export function getFileService(uri: Uri): FileService {
  let fileService: FileService | null | undefined;
  if (UResource.isRemote(uri)) {
    const remoteRoot = app.remoteExplorer.findRoot(uri);
    if (remoteRoot) {
      fileService = remoteRoot.explorerContext.fileService;
    }
  } else {
    fileService = serviceManager.findPrefix(normalizePathForTrie(uri.fsPath));
  }

  return fileService!;
}

export function disposeFileService(fileService: FileService) {
  serviceManager.remove(fileService.baseDir);
  setContextValue('hasConfiguration', getAllFileService().length > 0);
  fileService.dispose();
}

/**
 * Dispose and recreate every service for a workspace, then refresh the explorer.
 * Shared by config-file saves and profile switches.
 *
 * `preserveProfile` keeps the currently active profile (used on profile switch,
 * where recreating must not reset to `defaultProfile`). Without it, a fresh
 * creation honors `defaultProfile` as before (config-save behavior).
 */
export async function reloadWorkspaceServices(
  workspacePath: string,
  options: { preserveProfile?: boolean } = {}
) {
  const activeProfile = app.state.profile;

  findAllFileService(service => service.workspace === workspacePath).forEach(
    disposeFileService
  );

  try {
    const configs = await readConfigsFromFile(path.join(workspacePath, CONFIG_PATH));
    createFileServices(configs, workspacePath, options);
    if (options.preserveProfile) {
      // Safety: restore the user's selection in case creation changed it.
      app.state.profile = activeProfile;
    }
  } catch (error) {
    reportError(error);
  } finally {
    if (app.remoteExplorer) {
      app.remoteExplorer.refresh();
    }
  }
}

export function findAllFileService(predictor: (x: FileService) => boolean): FileService[] {
  if (serviceManager === undefined) {
    return [];
  }

  return getAllFileService().filter(predictor);
}

export function getAllFileService(): FileService[] {
  if (serviceManager === undefined) {
    return [];
  }

  return serviceManager.getAllValues();
}

export function getRunningTransformTasks(): TransferTask[] {
  return getAllFileService().reduce<TransferTask[]>((acc, fileService) => {
    return acc.concat(fileService.getPendingTransferTasks());
  }, []);
}

export function selectServiceProfile(service: FileService, profile: string | null) {
  if (!getAllFileService().includes(service)) throw new Error('Configuration changed; select the profile again');
  const raw=service.getRawConfiguration();
  const preview=service.forProfile(profile);
  try { preview.getConfig(); } finally { preview.dispose(); }
  const nextBase=getBasePath(resolveProfileContext(raw,profile),service.workspace);
  if(getAllFileService().some(other=>other!==service && other.baseDir===nextBase)) throw new Error('This profile overlaps another configured local context');
  disposeFileService(service);
  createFileService(raw,service.workspace,{profile});
  app.state.profile=profile;
  app.remoteExplorer?.refresh();
}

export function createFileServices(configs:any[],workspace:string,options:{preserveProfile?:boolean}={}) {
  const roots=new Set(getAllFileService().map(service=>service.baseDir));
  for(const config of configs){
    const requested=options.preserveProfile?app.state.profile:config.defaultProfile || null;
    const selected=requested && config.profiles && !config.profiles[requested]?config.defaultProfile || null:requested;
    const base=getBasePath(resolveProfileContext(config,selected),workspace);
    if(roots.has(base))throw new Error('Duplicate SFTP local context: '+base+'. Use distinct contexts or named contexts with one active selection.');
    roots.add(base);
  }
  configs.forEach(config=>createFileService(config,workspace,options));
}
