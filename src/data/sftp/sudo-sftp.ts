// ssh2's SFTP codec is attached to an authenticated exec channel instead of a subsystem.
// Keep this compatibility adapter in the data layer; wire tests exercise its lifecycle.
const {SFTP} = require('ssh2/lib/protocol/SFTP');

export function sudoSftpCommand(option: {sftpServerPath?:string}): string {
  const path=option.sftpServerPath;
  if(path!==undefined && (typeof path!=='string'||!path.startsWith('/')||/[\r\n\0]/.test(path)||path.length>4096))throw new Error('sftpServerPath must be an absolute remote executable path');
  const quote=(value:string)=>"'"+value.replace(/'/g,"'\"'\"'")+"'";
  if(path)return 'exec sudo -n -- '+quote(path);
  return 'for p in /usr/lib/openssh/sftp-server /usr/libexec/openssh/sftp-server /usr/lib/ssh/sftp-server; do if [ -x "$p" ]; then exec sudo -n -- "$p"; fi; done; exit 127';
}

export function openSudoSftp(client:any,option:{sftpServerPath?:string;connectTimeout?:number}):Promise<any>{
  const command=sudoSftpCommand(option);
  return new Promise((resolve,reject)=>{
    let codec:any,channel:any,settled=false;
    const failure=()=>Object.assign(new Error('Sudo SFTP could not start. The SSH login must be allowed to run the SFTP server with non-interactive sudo (sudo -n), without a password prompt or TTY. Check sudo policy and sftpServerPath on the server. Normal-user SFTP was not used as a fallback.'),{code:'SUDO_SFTP_START_FAILED'});
    const timer=setTimeout(()=>finish(failure()),option.connectTimeout||30000);
    const finish=(error?:Error)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      if(error){if(codec)codec.destroy();else channel?.close();reject(error);}else resolve(codec);
    };
    try { client.exec(command,{pty:false},(error:any,stream:any)=>{
      if(error){finish(failure());return;}
      channel=stream;
      if(settled){stream.close();return;}
      stream.stderr.on('data',()=>{}); // Never expose arbitrary remote stderr or credentials.
      codec=new SFTP(client,{type:stream.type,incoming:stream.incoming,outgoing:stream.outgoing},{});
      codec.stderr=stream.stderr;
      codec.on('error',()=>{if(!settled)finish(failure());});
      codec.once('ready',()=>finish());
      codec.once('close',()=>{if(!settled)finish(failure());});
      codec.once('exit',()=>{if(!settled)finish(failure());});
      // Preserve the real channel IDs, windows and ssh2 dispatcher/backpressure.
      client._chanMgr.update(stream.incoming.id,codec);
      codec._init();
    }); } catch { finish(failure()); }
  });
}
