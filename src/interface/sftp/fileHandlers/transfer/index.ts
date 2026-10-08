// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import {showConfirmMessage} from '../../host';
import { refreshRemoteExplorer } from '../shared';
import createFileHandler, { FileHandlerContext } from '../createFileHandler';
import { TransferOption, SyncOption, TransferDirection } from '../../../../logic/sftp/fileHandlers/transfer/transfer';

import {executeTransfer} from '../../../../logic/sftp/transfer-operation';

function createTransferHandle(direction: TransferDirection, synchronize = false) {
  return async function handle(this: FileHandlerContext, option: TransferOption) {
    const check = this.fileService.cancellationCheck();
    if (synchronize && (option as SyncOption).delete) {
      const remote = `${this.fileService.name} (${this.config.host}:${this.config.port}) ${this.target.remoteFsPath}`;
      const destination = (option as SyncOption).bothDiretions ? `${remote} and local ${this.target.localFsPath}`
        : direction === TransferDirection.REMOTE_TO_LOCAL ? `local ${this.target.localFsPath}` : remote;
      if (!await showConfirmMessage(`Synchronize and delete destination-only files at ${destination}?`, 'Sync and delete', 'Cancel')) return;
    }
    check();
    return executeTransfer(this.fileService, this.config, this.target.localFsPath, this.target.remoteFsPath,
      direction === TransferDirection.REMOTE_TO_LOCAL,
      {...option, filePerm: this.config.filePerm, dirPerm: this.config.dirPerm}, synchronize);
  };
}

const uploadHandle = createTransferHandle(TransferDirection.LOCAL_TO_REMOTE);
const downloadHandle = createTransferHandle(TransferDirection.REMOTE_TO_LOCAL);

export const sync2Remote = createFileHandler<SyncOption>({
  name: 'sync local ➞ remote',
  handle: createTransferHandle(TransferDirection.LOCAL_TO_REMOTE, true),
  transformOption() {
    const config = this.config;
    const syncOption = config.syncOption || {};
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.filePerm && !config.dirPerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
      delete: syncOption.delete,
      skipCreate: syncOption.skipCreate,
      ignoreExisting: syncOption.ignoreExisting,
      update: syncOption.update,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, true);
  },
});

export const sync2Local = createFileHandler<SyncOption>({
  name: 'sync remote ➞ local',
  handle: createTransferHandle(TransferDirection.REMOTE_TO_LOCAL, true),
  transformOption() {
    const config = this.config;
    const syncOption = config.syncOption || {};
    return {
      perserveTargetMode: false,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
      delete: syncOption.delete,
      skipCreate: syncOption.skipCreate,
      ignoreExisting: syncOption.ignoreExisting,
      update: syncOption.update,
    };
  },
});

export const upload = createFileHandler<TransferOption>({
  name: 'upload',
  handle: uploadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.filePerm && !config.dirPerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, this.fileService);
  },
});

export const uploadFile = createFileHandler<TransferOption>({
  name: 'upload file',
  handle: uploadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.filePerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, false);
  },
});

export const uploadFolder = createFileHandler<TransferOption>({
  name: 'upload folder',
  handle: uploadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.dirPerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, true);
  },
});

export const download = createFileHandler<TransferOption>({
  name: 'download',
  handle: downloadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: false,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
    };
  },
});

export const downloadFile = createFileHandler<TransferOption>({
  name: 'download file',
  handle: downloadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: false,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
    };
  },
});

export const downloadFolder = createFileHandler<TransferOption>({
  name: 'download folder',
  handle: downloadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: false,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
    };
  },
});
