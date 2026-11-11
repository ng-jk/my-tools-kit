import * as path from 'path';
import { createDiffTemp } from '../../data/sftp/diff-temp';
import { FileService, FileType, LocalFileSystem, TransferDirection, TransferTask } from './core';
import { requireDiffFile } from './diagnostics';
import { registerActiveTransfer } from './transfer-operation';

export async function downloadDiffFile(service: FileService, config: ReturnType<FileService['getConfig']>,
  local: string, remote: string, signal: AbortSignal) {
  if (signal.aborted) return;
  const checkService = service.cancellationCheck();
  const release = service.retainTransferResources();
  let task: TransferTask | undefined;
  let temp: Awaited<ReturnType<typeof createDiffTemp>> | undefined;
  let cancelled = false;
  let finishCancellation: () => void;
  const cancellation = new Promise<undefined>(resolve => { finishCancellation = () => resolve(undefined); });
  const cancel = () => {
    cancelled = true;
    finishCancellation();
    task?.cancel();
  };
  const check = () => {
    checkService();
    if (cancelled) throw new Error('Transfer cancelled');
  };
  const unregister = registerActiveTransfer(cancel);
  const removeListener = service.onCancellation(cancel);
  signal.addEventListener('abort', cancel, {once: true});

  // The notification can close immediately. A pending protocol request still
  // owns its connection until it settles, and must not start the next step.
  const download = async () => {
    try {
      check();
      await requireDiffFile(service.getLocalFileSystem(), local, 'local', FileType.File);
      check();
      const remoteFs = await service.getRemoteFileSystem(config);
      check();
      await requireDiffFile(remoteFs, remote, 'remote', FileType.File);
      check();
      temp = await createDiffTemp(local);
      check();
      task = new TransferTask(
        {fsPath: remote, fileSystem: remoteFs},
        {fsPath: temp.file, fileSystem: new LocalFileSystem(path, path.dirname(temp.file))},
        {
          fileType: FileType.File,
          transferDirection: TransferDirection.REMOTE_TO_LOCAL,
          transferOption: {atime: 0, mtime: 0, mode: 0o600, perserveTargetMode: false},
        },
      );
      await task.run();
      check();
      const result = temp;
      temp = undefined;
      return result;
    } finally {
      signal.removeEventListener('abort', cancel);
      removeListener();
      unregister();
      try { await temp?.dispose(); } finally { release(); }
    }
  };
  return Promise.race([download(), cancellation]);
}
