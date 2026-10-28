// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import Client from 'ftp';
import RemoteClient, { ConnectOption } from './remoteClient';

// tslint:disable
Client.prototype._send = function(cmd: string, cb: (err: Error) => void, promote: boolean) {
  if (cmd !== undefined && /[\r\n\x00]/.test(cmd)) {
    const error = new Error('FTP command contains a prohibited control character');
    if (typeof cb === 'function') queueMicrotask(() => cb(error)); else this.emit('error', error);
    return;
  }
  clearTimeout(this._keepalive);
  if (cmd !== undefined) {
    if (promote) this._queue.unshift({ cmd: cmd, cb: cb });
    else this._queue.push({ cmd: cmd, cb: cb });

    if (cmd === 'ABOR') {
      // A failed passive handshake has no active request. Associate the abort
      // reply now so its callback can reject the failed transfer promptly.
      if (!this._curReq) this._curReq = this._queue.shift();
      if (this._pasvSocket) this._pasvSocket.aborting = true;
      this._debug && this._debug('[connection] > ' + cmd);
      this._socket.write(cmd + '\r\n');
      return;
    }
  }
  var queueLen = this._queue.length;
  if (!this._curReq && queueLen && this._socket && this._socket.readable) {
    this._curReq = this._queue.shift();
    if (this._curReq.cmd !== 'ABOR') {
      this._debug && this._debug('[connection] > ' + this._curReq.cmd);
      this._socket.write(this._curReq.cmd + '\r\n');
    }
  } else if (!this._curReq && !queueLen && this._ending) this._reset();
};
// tslint:enable

Client.prototype.setLastMod = function(path: string, date: Date, cb: (err: Error) => void) {
  const dateStr =
    date.getUTCFullYear() +
    ('00' + (date.getUTCMonth() + 1)).slice(-2) +
    ('00' + date.getUTCDate()).slice(-2) +
    ('00' + date.getUTCHours()).slice(-2) +
    ('00' + date.getUTCMinutes()).slice(-2) +
    ('00' + date.getUTCSeconds()).slice(-2);

  this._send('MFMT ' + dateStr + ' ' + path, cb);
};

export default class FTPClient extends RemoteClient {
  private connected: boolean = false;

  _initClient() {
    return new Client();
  }

  _hasProvideAuth(connectOption: ConnectOption) {
    // tslint:disable-next-line triple-equals
    return connectOption.password != undefined;
  }

  _doConnect(connectOption: ConnectOption): Promise<void> {
    this.onDisconnected(() => {
      this.connected = false;
    });

    const { username, connectTimeout = 3 * 1000, ...option } = connectOption;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.connected) {
          this.end();
          reject(new Error('Timeout while connecting to server'));
        }
      }, connectTimeout);

      this._client
        .on('ready', () => {
          clearTimeout(timer);
          this.connected = true;
          if (option.passive) {
            this._client._pasv(resolve);
          } else {
            resolve();
          }
        })
        .once('close',()=>{clearTimeout(timer);if(!this.connected)reject(new Error('FTP connection closed before authentication'));})
        .on('error', (err: any) => {
          clearTimeout(timer);
          reject(err);
        })
        .connect({
          keepalive: 1000 * 10, // 10 secs, original
          // keepalive: 1000 * 600, // 10 mins
          // keepalive: 1000 * 1800, // 30 mins
          pasvTimeout: connectTimeout,
          ...option,
          connTimeout: connectTimeout,
          user: username,
        });
    });
  }

  async fork(signal?:AbortSignal):Promise<FTPClient> {
    const peer=new FTPClient({...this._option});
    let rejectCancellation:(error:Error)=>void;
    const cancelled=new Promise<never>((_resolve,reject)=>{rejectCancellation=reject;});
    const abort=()=>{peer.end();rejectCancellation!(new Error('Transfer cancelled'));};
    if(signal?.aborted)throw new Error('Transfer cancelled');
    signal?.addEventListener('abort',abort,{once:true});
    try {
      await Promise.race([peer.connect({...this._option},{askForPasswd:async()=>{throw new Error('FTP worker authentication is unavailable');}}),cancelled]);
      if(signal?.aborted)throw new Error('Transfer cancelled');
      return peer;
    } catch(error){peer.end();throw error;}
    finally{signal?.removeEventListener('abort',abort);}
  }

  end() {
    return this._client.end();
  }

  getFsClient() {
    return this._client;
  }
}
