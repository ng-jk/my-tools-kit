import {existsSync} from 'fs';
import {sshDestination} from './ssh-destination';
import * as os from 'os';
import * as path from 'path';
import {createHash} from 'crypto';
// Passwords and tokens never participate in directory names or metadata.
export function legacyBackupPath(workspace:string,base:string,config:any,profile?:string) {
 const identity=JSON.stringify([path.resolve(workspace),path.resolve(base),profile||'',config.protocol,config.host,config.port,config.username,config.remotePath]);
 return path.join(os.homedir(),'.devkit-backups','sftp',createHash('sha256').update(identity).digest('hex'));
}

export function defaultBackupPath(workspace:string,base:string,config:any,profile?:string) {
 const destination=config.protocol==='sftp'?sshDestination(config):config;
 const identity=JSON.stringify(['destination-v2',path.resolve(workspace),path.resolve(base),profile||'',config.protocol,String(destination.host||'').toLowerCase(),destination.port,destination.username===undefined?null:destination.username,destination.sudo===true,config.remotePath]);
 return path.join(os.homedir(),'.devkit-backups','sftp',createHash('sha256').update(identity).digest('hex'));
}

export function existingLegacyBackupPath(workspace:string,base:string,config:any,profile?:string):string|undefined {
 const previous=legacyBackupPath(workspace,base,config,profile);
 return existsSync(previous)?previous:undefined;
}
