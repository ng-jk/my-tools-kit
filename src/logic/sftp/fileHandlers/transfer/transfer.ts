// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import {
  FileSystem,
  FileEntry,
  FileType,
  TransferTask,
  TransferOption as TransferTaskTransferOption,
  TransferDirection,
  fileOperations,
} from '../../core/index';
import { FileHandleOption } from '../option';
import { flatten } from '../../utils';
import { logger } from '../../../../data/sftp/ports';
import { getOpenTextDocuments } from '../../../../data/sftp/ports';
import { checkedEntries } from '../../../../data/sftp/path-safety';
import {ensureTransferDirectory, DirectoryPermissionScope} from '../../directory-permissions';
import {transferPermissions} from '../../transfer-permissions';

interface InternalTransferOption extends FileHandleOption, TransferTaskTransferOption {}

type ExternalTransferOption<T extends InternalTransferOption> = Pick<
  T,
  Exclude<keyof T, 'mtime' | 'atime' | 'mode' | 'fallbackMode'>
>;

type TransferOption = ExternalTransferOption<InternalTransferOption>;
interface SyncOption extends TransferOption {
  // delete extraneous files from dest dirs
  delete?: boolean;

  // skip creating new files on dest
  skipCreate?: boolean;

  // skip updating files that exist on dest
  ignoreExisting?: boolean;

  // update the dest only if a newer version is on the src filesystem
  update?: boolean;

  // make newest file to be present in both locations.
  bothDiretions?: boolean;
}

interface BaseTransferHandleConfig {
  directoryScope?: DirectoryPermissionScope;
  srcFsPath: string;
  targetFsPath: string;
  dirPerm?: number,
  filePerm?: number,
  srcFs: FileSystem;
  targetFs: FileSystem;
  transferDirection: TransferDirection;
}

interface TransferHandleConfig<T> extends BaseTransferHandleConfig {
  transferOption: T;
}

function getAltDirection(direction: TransferDirection) {
  return direction === TransferDirection.LOCAL_TO_REMOTE
    ? TransferDirection.REMOTE_TO_LOCAL
    : TransferDirection.LOCAL_TO_REMOTE;
}

async function isFileModified(a: FileEntry, b: FileEntry, fromFs: FileSystem, toFs: FileSystem): Promise<boolean> {
  if (a.type !== b.type) return true;
  if (a.type === FileType.SymbolicLink) return (await fromFs.readlink(a.fspath)) !== (await toFs.readlink(b.fspath));
  // compare time at seconds
  return Math.floor(a.mtime / 1000) !== Math.floor(b.mtime / 1000) || a.size !== b.size;
}

function toHash<T, R = T>(items: T[], key: string, transform?: (a: T) => R): { [key: string]: R } {
  return items.reduce((hash: { [key: string]: R }, item) => {
    const transformedItem = transform ? transform(item) : (item as unknown as R);
    hash[(transformedItem as any)[key]] = transformedItem;
    return hash;
  }, Object.create(null) as { [key: string]: R });
}

function rejectDestinationCollisions(entries: FileEntry[], target: FileSystem, directory: string) {
  const names=new Map<string,string>();
  for(const entry of entries) {
    const pathname=target.pathResolver.join(directory,entry.name);
    const identity=target.pathIdentity ? target.pathIdentity(pathname) : target.pathResolver.normalize(pathname);
    if(names.has(identity)) throw new Error('Destination filename collision: '+names.get(identity)+' and '+entry.name);
    names.set(identity,entry.name);
  }
}

async function transferFolder(
  config: TransferHandleConfig<TransferOption>,
  collect: (t: TransferTask) => void
) {
  const { srcFsPath, targetFsPath, srcFs, targetFs, transferOption } = config;

  if (transferOption.ignore && transferOption.ignore(srcFsPath)) {
    return;
  }

  const fileEntries = checkedEntries(srcFs, srcFsPath, await srcFs.list(srcFsPath));
  rejectDestinationCollisions(fileEntries,targetFs,targetFsPath);

  // Need this to make sure file can correct transfer
  await ensureTransferDirectory(srcFs, targetFs, srcFsPath, targetFsPath, transferPermissions(transferOption, config.transferDirection === TransferDirection.LOCAL_TO_REMOTE).dirPerm, config.directoryScope);

  await settleAll(
    fileEntries.map(file =>
      transferWithType(
        {
          ...config,
          transferOption: {
            ...config.transferOption,
            fallbackMode: file.mode,
            mtime: file.mtime,
            atime: file.atime,
          },
          srcFsPath: file.fspath,
          targetFsPath: targetFs.pathResolver.join(targetFsPath, file.name),
          ensureDirExist: false,
        },
        file.type,
        collect
      )
    )
  );

  logger.info('folder transfered.');
}

async function transferFile(
  config: TransferHandleConfig<InternalTransferOption>,
  fileType: FileType,
  collect: (t: TransferTask) => void
) {
  if (config.transferOption.ignore && config.transferOption.ignore(config.srcFsPath)) {
    return;
  }

  collect(
    new TransferTask(
      {
        fsPath: config.srcFsPath,
        fileSystem: config.srcFs,
      },
      {
        fsPath: config.targetFsPath,
        fileSystem: config.targetFs,
      },
      {
        fileType,
        transferDirection: config.transferDirection,
        transferOption: config.transferOption,
      }
    )
  );
}

async function transferWithType(
  config: TransferHandleConfig<InternalTransferOption> & {
    ensureDirExist: boolean;
  },
  fileType: FileType,
  collect: (t: TransferTask) => void
) {
  switch (fileType) {
    case FileType.Directory:
      await transferFolder(config, collect);
      break;
    case FileType.File:
    case FileType.SymbolicLink:
      if (config.ensureDirExist) {
        const { targetFs, targetFsPath } = config;
        await ensureTransferDirectory(config.srcFs, targetFs, config.srcFs.pathResolver.dirname(config.srcFsPath), targetFs.pathResolver.dirname(targetFsPath), transferPermissions(config.transferOption, config.transferDirection === TransferDirection.LOCAL_TO_REMOTE).dirPerm, config.directoryScope);
      }
      await transferFile(config, fileType, collect);
      break;
    default:
      logger.warn(`Unsupported file type (type = ${fileType}). File ${config.srcFsPath}`);
  }
}

async function removeFile(file: string, fs: FileSystem, fileType: FileType, option: any) {
  if (option.ignore && option.ignore(file)) {
    return;
  }

  switch (fileType) {
    case FileType.Directory:
      for (const entry of checkedEntries(fs, file, await fs.list(file))) {
        await removeFile(entry.fspath, fs, entry.type, option);
      }
      // Ignored descendants retain their ancestors; never recursively bypass ignore policy.
      if ((await fs.list(file)).length) return;
      await fs.rmdir(file, false);
      logger.info('folder removed.');
      break;
    case FileType.File:
    case FileType.SymbolicLink:
      await fileOperations.removeFile(file, fs, option);
      logger.info('file removed.');
      break;
    default:
      break;
  }
}

async function _sync(
  config: TransferHandleConfig<SyncOption>,
  collect: (t: TransferTask) => void,
  deleted: FileEntry[]
) {

  const { srcFsPath, targetFsPath, srcFs, targetFs, transferOption, transferDirection } = config;
  if (transferOption.delete && !transferOption.bothDiretions && srcFs.supportsCompleteDirectoryListing === false) {
    throw new Error('Destructive sync requires a complete source directory listing; FTP LIST cannot guarantee hidden entries. Use SFTP or disable syncOption.delete.');
  }
  if (transferOption.ignore && transferOption.ignore(srcFsPath)) {
    return;
  }

  const altDirection = getAltDirection(transferDirection);
  const syncFiles = async (srcFileEntries: FileEntry[], desFileEntries: FileEntry[]) => {
    checkedEntries(srcFs, srcFsPath, srcFileEntries);
    checkedEntries(targetFs, targetFsPath, desFileEntries);
    const sourceIgnoresCase=srcFs.pathIdentity && srcFs.pathIdentity(srcFs.pathResolver.join(srcFsPath,'a'))===srcFs.pathIdentity(srcFs.pathResolver.join(srcFsPath,'A'));
    const matchingFs=transferOption.bothDiretions && sourceIgnoresCase ? srcFs : targetFs;
    const matchingRoot=matchingFs===srcFs ? srcFsPath : targetFsPath;
    const matchName=(name:string) => {const pathname=matchingFs.pathResolver.join(matchingRoot,name);return matchingFs.pathIdentity ? matchingFs.pathIdentity(pathname) : matchingFs.pathResolver.normalize(pathname);};
    const srcFileTable = toHash(srcFileEntries, 'id', fileEntry => ({
      ...fileEntry,
      id: matchName(fileEntry.name),
    }));

    const desFileTable = toHash(desFileEntries, 'id', fileEntry => ({
      ...fileEntry,
      id: matchName(fileEntry.name),
    }));

    const file2trans: [string, string, TransferDirection, FileType, InternalTransferOption][] = [];
    const dir2trans: [string, string, TransferDirection][] = [];
    const dir2sync: [string, string][] = [];

    const fileMissed: string[] = [];
    const dirMissed: string[] = [];

    await settleAll(Object.keys(srcFileTable).map(async id => {
      const srcFile = srcFileTable[id];
      const desFile = desFileTable[id];
      delete desFileTable[id];
      if (transferOption.ignore && (transferOption.ignore(srcFile.fspath) || (desFile && transferOption.ignore(desFile.fspath)))) return;

      // files exist on both side
      if (desFile) {
        if (transferOption.ignoreExisting && !(srcFile.type === FileType.Directory && desFile.type === FileType.Directory)) return;
        if (srcFile.type !== desFile.type && (srcFile.type === FileType.Directory || desFile.type === FileType.Directory)) {
          throw new Error('Sync file/directory type conflict: ' + srcFile.fspath + ' and ' + desFile.fspath);
        }

        let from: FileEntry = srcFile;
        let to: FileEntry = desFile;
        let direction: TransferDirection = transferDirection;
        switch (from.type) {
          case FileType.Directory:
            dir2sync.push([from.fspath, to.fspath]);
            break;
          case FileType.File:
          case FileType.SymbolicLink:
            if (transferOption.bothDiretions) {
              // from new to old
              if (desFile.mtime > srcFile.mtime) {
                from = desFile;
                to = srcFile;
                direction = altDirection;
              }
            }

            if (transferOption.update) {
              if (from.mtime <= to.mtime) {
                return;
              }
            }

            // only transfer changed files
            if (await isFileModified(from, to, direction === transferDirection ? srcFs : targetFs, direction === transferDirection ? targetFs : srcFs)) {
              file2trans.push([
                from.fspath,
                to.fspath,
                direction,
                from.type,
                {
                  ...transferOption,
                  mode: to.type === FileType.File ? to.mode : undefined,
                  fallbackMode: from.mode,
                  mtime: from.mtime,
                  atime: from.atime,
                },
              ]);
            }
            break;
          default:
          // do not process
        }
        return;
      }

      // files exist only on src
      if (transferOption.skipCreate) {
        return;
      }

      const fspath = targetFs.pathResolver.join(targetFsPath, srcFile.name);
      switch (srcFile.type) {
        case FileType.Directory:
          dir2trans.push([srcFile.fspath, fspath, transferDirection]);
          break;
        case FileType.File:
        case FileType.SymbolicLink:
          file2trans.push([
            srcFile.fspath,
            fspath,
            transferDirection,
            srcFile.type,
            {
              ...transferOption,
              fallbackMode: srcFile.mode,
              mtime: srcFile.mtime,
              atime: srcFile.atime,
            },
          ]);
          break;
        default:
        // do not process
      }
    }));

    // files exist only on target
    if (transferOption.bothDiretions) {
      if (transferOption.skipCreate !== true) {
        Object.keys(desFileTable).forEach(id => {
          const file = desFileTable[id];
          const fspath = srcFs.pathResolver.join(srcFsPath, file.name);
          switch (file.type) {
            case FileType.Directory:
              dir2trans.push([file.fspath, fspath, altDirection]);
              break;
            case FileType.File:
            case FileType.SymbolicLink:
              file2trans.push([
                file.fspath,
                fspath,
                altDirection,
                file.type,
                {
                  ...transferOption,
                  fallbackMode: file.mode,
                  mtime: file.mtime,
                  atime: file.atime,
                },
              ]);
              break;
            default:
            // do not process
          }
        });
      }
    } else if (transferOption.delete) {
      Object.keys(desFileTable).forEach(id => {
        const file = desFileTable[id];
        deleted.push(file);
        switch (file.type) {
          case FileType.Directory:
            dirMissed.push(file.fspath);
            break;
          case FileType.File:
          case FileType.SymbolicLink:
            fileMissed.push(file.fspath);
            break;
          default:
          // do not process
        }
      });
    }

    // side-effect
    await settleAll(fileMissed.map(file => removeFile(file, targetFs, FileType.File, transferOption)));
    await settleAll(dirMissed.map(file => removeFile(file, targetFs, FileType.Directory, transferOption)));

    const transFilePromise = file2trans.map(([src, target, direction, type, option]) =>
      transferFile(
        {
          ...config,
          transferDirection: direction,
          srcFs: direction === transferDirection ? srcFs : targetFs,
          targetFs: direction === transferDirection ? targetFs : srcFs,
          transferOption: option,
          srcFsPath: src,
          targetFsPath: target,
        },
        type,
        collect
      )
    );

    const transDirPromise = dir2trans.map(([src, target, direction]) =>
      transferFolder(
        {
          ...config,
          transferDirection: direction,
          srcFs: direction === transferDirection ? srcFs : targetFs,
          targetFs: direction === transferDirection ? targetFs : srcFs,
          srcFsPath: src,
          targetFsPath: target,
        },
        collect
      )
    );

    const syncPromise = dir2sync.map(([src, target]) =>
      _sync(
        {
          ...config,
          srcFsPath: src,
          targetFsPath: target,
        },
        collect,
        deleted
      )
    );

    return settleAll([...transFilePromise, ...transDirPromise, ...syncPromise]).then(flatten);
  };

  // create dir here so we don't have to ensure it for children files.


  const sourceEntries=checkedEntries(srcFs,srcFsPath,await srcFs.list(srcFsPath));
  rejectDestinationCollisions(sourceEntries,targetFs,targetFsPath);
  await ensureTransferDirectory(srcFs, targetFs, srcFsPath, targetFsPath, transferPermissions(transferOption, config.transferDirection === TransferDirection.LOCAL_TO_REMOTE).dirPerm, config.directoryScope);
  const targetEntries=checkedEntries(targetFs,targetFsPath,await targetFs.list(targetFsPath));
  if(transferOption.bothDiretions) rejectDestinationCollisions(targetEntries,srcFs,srcFsPath);
  await syncFiles(sourceEntries,targetEntries);
}

export { TransferOption, SyncOption, TransferDirection };

export async function transfer(
  config: TransferHandleConfig<TransferOption>,
  collect: (t: TransferTask) => void
) {
  await saveDirtyDocuments(config);
  const stat = await config.srcFs.lstat(config.srcFsPath);
  const transferOption = {
    ...config.transferOption,
    fallbackMode: stat.mode,
    mtime: stat.mtime,
    atime: stat.atime,
    filePerm: config?.filePerm,
    dirPerm: config?.dirPerm
  };
  await transferWithType({ ...config, transferOption, ensureDirExist: true }, stat.type, collect);
}

export async function sync(
  config: TransferHandleConfig<SyncOption>,
  collect: (t: TransferTask) => void
): Promise<FileEntry[]> {
  await saveDirtyDocuments(config);
  const deleted: FileEntry[] = [];
  await _sync(config, collect, deleted);
  return deleted;
}

async function saveDirtyDocuments(config: TransferHandleConfig<SyncOption>) {
  const uploading = config.transferDirection === TransferDirection.LOCAL_TO_REMOTE;
  if (!uploading && !config.transferOption.bothDiretions) return;
  const fs = uploading ? config.srcFs : config.targetFs;
  const root = uploading ? config.srcFsPath : config.targetFsPath;
  for (const document of getOpenTextDocuments()) {
    if (document.isClosed || !document.isDirty || (document.uri && document.uri.scheme !== 'file')) continue;
    const relative = fs.pathResolver.relative(root, document.fileName);
    if (relative === '..' || relative.startsWith('../') || relative.startsWith('..\\') || fs.pathResolver.isAbsolute(relative)) continue;
    if (config.transferOption.ignore?.(document.fileName)) continue;
    if (await document.save() !== true) throw new Error('Could not save dirty document before transfer: ' + document.fileName);
  }
}

async function settleAll<T>(operations: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(operations);
  const failed = results.find(result => result.status === 'rejected');
  if (failed && failed.status === 'rejected') throw failed.reason;
  return results.map(result => (result as PromiseFulfilledResult<T>).value);
}
