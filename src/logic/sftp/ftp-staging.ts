import {FTPFileSystem} from '../../data/sftp/core/fs';
import {assertRemoteParentDirectories} from './parent-directories';

// Choose an existing staging root without imposing namespace mode/owner policy.
// Each upload still creates and verifies its own 0700 temporary directory.
// The authenticated server and other namespace writers are trusted.
export async function prepareFtpStaging(fs:FTPFileSystem,configured?:string):Promise<string> {
  const root=configured??await fs.getLoginDirectory();
  if(!fs.pathResolver.isAbsolute(root)||/[\r\n\0]/.test(root))throw new Error('ftpStagingPath must be an absolute server directory');
  const normalized=fs.pathResolver.normalize(root);
  await assertRemoteParentDirectories(fs,fs.pathResolver.join(normalized,'__devkit_staging_parent__'));
  return normalized;
}
