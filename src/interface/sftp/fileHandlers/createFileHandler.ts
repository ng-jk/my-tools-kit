// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { Uri } from 'vscode';
import * as path from 'path';
import app from '../app';
import { UResource, FileService, ServiceConfig } from '../../../logic/sftp/core/index';
import logger from '../logger';
import { getFileService } from '../modules/serviceManager/index';

interface FileHandlerConfig {
  _?: boolean;
}

export interface FileHandlerContext {
  transient?: boolean;
  target: UResource;
  fileService: FileService;
  config: ServiceConfig;
}

type FileHandlerContextMethod<R = void> = (this: FileHandlerContext) => R;
type FileHandlerContextMethodArg1<A, R = void> = (this: FileHandlerContext, a: A) => R;

interface FileHandlerOption<T> {
  name: string;
  handle: FileHandlerContextMethodArg1<T, Promise<any>>;
  afterHandle?: FileHandlerContextMethod;
  config?: FileHandlerConfig;
  transformOption?: FileHandlerContextMethod<T>;
}

export function handleCtxFromUri(uri: Uri): FileHandlerContext {
  const fileService = getFileService(uri);
  if (!fileService) {
    if (uri.toString(true) == "file:///${command:devkit.sftp.sync.remoteToLocal}") {
      throw '';
    } else {
      throw new Error(`Config Not Found. (${uri.toString(true)})`);
    }
  }
  const config = fileService.getConfig();
  const target = UResource.from(uri, {
    localBasePath: fileService.baseDir,
    remoteBasePath: config.remotePath,
    remoteId: fileService.id,
    remote: {
      host: config.host,
      port: config.port,
    },
  });

  return {
    fileService,
    config,
    target,
  };
}

export function allHandleCtxFromUri(uri: Uri): Array<FileHandlerContext> {
  const fileService = getFileService(uri);
  if (!fileService) {
    if (uri.toString(true) == "file:///${command:devkit.sftp.sync.remoteToLocal}") {
      throw '';
    } else {
      throw new Error(`Config Not Found. (${uri.toString(true)})`);
    }
  }

  const localPath = handleCtxFromUri(uri).target.localFsPath;
  const relative = path.relative(fileService.baseDir, localPath);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('File is outside the active context');
  return fileService.getAvailableProfiles().map(profile => {
    const profileService = fileService.forProfile(profile);
    const config = profileService.getConfig(profile);
    const target = UResource.from(Uri.file(path.resolve(profileService.baseDir, relative)), {
      localBasePath: profileService.baseDir,
      remoteBasePath: config.remotePath,
      remoteId: fileService.id,
      remote: {
        host: config.host,
        port: config.port,
      },
    });

    return {
      transient: true,
      fileService: profileService,
      config,
      target,
    };
  })
}

export default function createFileHandler<T>(
  handlerOption: FileHandlerOption<T>
): (ctx: FileHandlerContext | Uri, option?: Partial<T>) => Promise<void> {
  async function fileHandle(ctx: Uri | FileHandlerContext, option?: T) {
    const handleCtx = (ctx && typeof ctx.scheme === 'string' && typeof ctx.fsPath === 'string') ? handleCtxFromUri(ctx) : ctx;
    const { target } = handleCtx;

    const invokeOption = handlerOption.transformOption
      ? handlerOption.transformOption.call(handleCtx)
      : {};
    if (option) {
      Object.assign(invokeOption, option);
    }

    if (invokeOption.ignore && invokeOption.ignore(target.localFsPath, 'local')) {
      return;
    }

    logger.trace(`handle ${handlerOption.name} for`, target.localFsPath);

    app.sftpBarItem.startSpinner();
    try {
      await handlerOption.handle.call(handleCtx, invokeOption);
    // } catch (error) {
    //   reportError(error, `when ${handlerOption.name} ${target.localFsPath}`);
    //   Object.defineProperty(error, 'reported', {
    //     configurable: false,
    //     enumerable: false,
    //     value: true,
    //   });
    //   throw error;
    } finally {
      app.sftpBarItem.stopSpinner();
    }
    if (handlerOption.afterHandle && !handleCtx.transient) {
      await handlerOption.afterHandle.call(handleCtx);
    }
  }

  return fileHandle;
}
