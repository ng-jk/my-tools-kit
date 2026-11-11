import { chmod, unlink } from 'fs/promises';
import * as path from 'path';
import * as tmp from 'tmp';
import { EXTENSION_NAME } from './constants';
import { protectWindowsDirectory } from './windows-directory-permissions';

tmp.setGracefulCleanup();

export async function createDiffTemp(localPath: string) {
  const directory = tmp.dirSync({prefix: EXTENSION_NAME+'-diff-', mode: 0o700});
  try {
    // Protect the directory before any snapshot or staging file can exist.
    if (process.platform === 'win32') await protectWindowsDirectory(directory.name);
    else await chmod(directory.name, 0o700);
  } catch (error) {
    try { directory.removeCallback(); } catch {}
    throw error;
  }

  const file = path.join(directory.name, 'remote'+path.extname(localPath));
  let disposed = false;
  return {
    file,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await unlink(file).catch(() => {});
      try { directory.removeCallback(); } catch {}
    },
  };
}
