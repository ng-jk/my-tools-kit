import { unlink } from 'fs/promises';
import * as path from 'path';
import * as tmp from 'tmp';
import { EXTENSION_NAME } from './constants';

export async function createDiffTemp(localPath: string) {
  const file = await new Promise<string>((resolve, reject) => {
    tmp.file({prefix: EXTENSION_NAME+'-', postfix: path.extname(localPath), discardDescriptor: true},
      (error, file) => error ? reject(error) : resolve(file));
  });
  return {file, dispose: async () => { await unlink(file).catch(() => {}); }};
}
