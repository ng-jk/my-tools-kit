import {sshDestination} from '../../data/sftp/ssh-destination';

export function connectionDescription(config:any):string {
 if(config.protocol==='sftp'){
  const target=sshDestination(config);
  return `${target.host}:${target.port} (${target.sudo?'sudo / root requested':'login account'})`;
 }
 return `${config.host}:${config.port??(config.protocol==='ftp'?21:22)} (login account)`;
}
