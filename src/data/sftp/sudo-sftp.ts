// Compatibility adapter for ssh2's SFTP codec over an authenticated exec channel.
const {SFTP} = require('ssh2/lib/protocol/SFTP');
import {randomBytes} from 'crypto';

export function sudoSftpCommand(option:{sftpServerPath?:string}):string {
 const path=option.sftpServerPath;
 if(path!==undefined && (typeof path!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(path)||path.length>4096))throw new Error('sftpServerPath must be an absolute remote executable path using letters, digits, slash, dot, underscore or hyphen');
 const launch=path?'exec '+path:'for p in /usr/lib/openssh/sftp-server /usr/libexec/openssh/sftp-server /usr/lib/ssh/sftp-server; do if [ -x "$p" ]; then exec "$p"; fi; done; exit 127';
 // No challenge appears in the command: reflected command diagnostics cannot
 // authenticate startup. The root launcher reads it from stdin after sudo.
 return '/usr/bin/sudo -n -- /bin/sh -c \'PATH=/usr/sbin:/usr/bin:/sbin:/bin; export PATH; IFS= read -r token; [ "$(/usr/bin/id -u)" = 0 ] || exit 126; printf "%s\\n" "$token" >&2; '+launch+"'";
}

export function openSudoSftp(client:any,option:{sftpServerPath?:string;connectTimeout?:number}):Promise<any>{
 const marker='DEVKIT_SUDO_'+randomBytes(24).toString('hex');
 const command=sudoSftpCommand(option);
 return new Promise((resolve,reject)=>{
  let codec:any,channel:any,settled=false,confirmed=false,ready=false,terminated=false,tail='';
  const failure=()=>Object.assign(new Error('Sudo SFTP could not start or confirm its launcher. The SSH login must be allowed to run the elevated /bin/sh SFTP launcher with non-interactive sudo (sudo -n), without a password prompt or TTY. Check sudo policy, forced SSH commands and sftpServerPath on the server. Normal-user SFTP was not used as a fallback.'),{code:'SUDO_SFTP_START_FAILED'});
  const timer=setTimeout(()=>finish(failure()),option.connectTimeout||30000);
  const finish=(error?:Error)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   if(error){codec?.destroy();channel?.close();client.destroy();reject(error);}else resolve(codec);
  };
  const lost=()=>{if(terminated)return;terminated=true;client.emit('devkit-sftp-channel-closed');if(!settled)finish(failure());else client.destroy();};
  const expose=()=>{if(ready&&confirmed){if(terminated||!codec.readable||codec.outgoing.state!=='open')finish(failure());else finish();}};
  try{client.exec(command,{pty:false},(error:any,stream:any)=>{
   if(error){finish(failure());return;}
   channel=stream;if(settled){stream.close();return;}
   stream.stderr.on('data',(data:Buffer)=>{
    if(confirmed)return;
    tail=(tail+data.toString('ascii')).slice(-4096);
    let newline;
    while((newline=tail.indexOf('\n'))>=0){
     const line=tail.slice(0,newline);tail=tail.slice(newline+1);
     if(line===marker){confirmed=true;tail='';expose();break;}
    }
   });
   stream.once('error',lost);stream.once('end',lost);stream.once('close',lost);
   stream.write(marker+'\n',()=>{
   if(settled||terminated){stream.close();return;}
   codec=new SFTP(client,{type:stream.type,incoming:stream.incoming,outgoing:stream.outgoing},{});
   codec.stderr=stream.stderr;
   // ssh2 flushes outstanding limits callbacks before emitting end on EOF;
   // mark the channel dead first so those callbacks cannot expose it as ready.
   const push=codec.push.bind(codec);
   codec.push=(data:any)=>{if(data===null)lost();return push(data);};
   codec.on('error',lost);codec.once('end',lost);codec.once('close',lost);codec.once('exit',lost);
   codec.once('ready',()=>{ready=true;expose();});
   client._chanMgr.update(stream.incoming.id,codec);
   codec._init();
   });
  });}catch{finish(failure());}
 });
}
