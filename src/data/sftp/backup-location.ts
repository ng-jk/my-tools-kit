import * as os from 'os';
import * as path from 'path';
import {createHash} from 'crypto';
// Passwords and tokens never participate in directory names or metadata.
export function defaultBackupPath(workspace:string,base:string,config:any,profile?:string) {
 const identity=JSON.stringify([path.resolve(workspace),path.resolve(base),profile||'',config.protocol,config.host,config.port,config.username,config.remotePath]);
 return path.join(os.homedir(),'.devkit-backups','sftp',createHash('sha256').update(identity).digest('hex'));
}
