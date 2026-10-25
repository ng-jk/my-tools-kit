// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import { Readable } from 'stream';
import FileSystem, { FileOption,FileType } from './fileSystem';
import { RemoteClient, ConnectOption, RemoteClientConfig } from '../remote-client/index';

interface RFSOptionDefaults {
  remoteTimeOffsetInHours: number;
}

type RFSOption = Partial<RFSOptionDefaults> & {
  client?: RemoteClient;
  clientOption?: ConnectOption;
};

const SECONDS_PER_HOUR = 60 * 60;
const MILLISECONDS_PER_HOUR = SECONDS_PER_HOUR * 1000;

const defaultOption: RFSOptionDefaults = {
  remoteTimeOffsetInHours: 0,
};

export default abstract class RemoteFileSystem extends FileSystem {
  protected client: RemoteClient;
  private _remoteTimeOffsetInMilliseconds: number = 0;
  private _remoteTimeOffsetInSeconds: number = 0;

  constructor(pathResolver: any, option: RFSOption) {
    super(pathResolver);

    const _option = {
      ...defaultOption,
      ...option,
    };
    const { client, clientOption, remoteTimeOffsetInHours } = _option;
    if (client) {
      this.client = client;
    } else if (clientOption) {
      this.client = this._createClient(clientOption);
    } else {
      throw new Error('No client or clientOption is provided');
    }

    this.setRemoteTimeOffsetInHours(remoteTimeOffsetInHours);
  }

  async establishDirectoryMode(path:string,mode:number):Promise<void>{
    // Remote paths cannot bind chmod to a non-following directory identity.
    await this.verifyDirectoryMode(path,mode);
  }

  async assertIsolatedParents(path:string,allowMissing=false):Promise<void>{
    const paths:string[]=[];
    let current=this.pathResolver.dirname(path);
    while(true){paths.push(current);const parent=this.pathResolver.dirname(current);if(current==='/'||parent===current)break;current=parent;}
    paths.reverse();
    const root=await this.parentIsolationStat(paths[0]);
    const safeMode=(stat:any,name:string)=>{
      if(stat.type!==FileType.Directory||!Number.isInteger(stat.mode)||(stat.mode&0o022)!==0)throw new Error('Remote ancestor is shared-writable or unverifiable: '+name+'. Upload stopped before mutations; use a non-shared server directory.');
      if(!Number.isSafeInteger(stat.uid)||stat.uid<0)throw new Error('Remote ancestor ownership is unverifiable: '+name+'. Upload stopped before mutations.');
    };
    safeMode(root,paths[0]);
    const owners=new Set<number>([root.uid!,0]);
    // The authenticated server's initial home is a trust anchor alongside its
    // namespace root. Require consistent ownership for virtual non-root jails.
    let home:any;
    try{home=await this.parentIsolationStat('.');}catch{}
    if(home?.type===FileType.Directory && Number.isSafeInteger(home.uid) && home.uid>=0){
      if(root.uid!==0 && root.uid!==home.uid)throw new Error('Remote namespace root and authenticated home have inconsistent ownership. Upload stopped before mutations.');
      owners.add(home.uid);
    }
    for(let i=1;i<paths.length;i++){
      let stat;
      try{stat=await this.parentIsolationStat(paths[i]);}catch(error){if(allowMissing&&(error.code==='ENOENT'||error.code===2))continue;throw error;}
      safeMode(stat,paths[i]);
      if(!owners.has(stat.uid!))throw new Error('Remote ancestor has an untrusted owner: '+paths[i]+'. Upload stopped before mutations; use a directory owned by the transfer account or server administrator.');
    }
  }

  protected parentIsolationStat(path:string):Promise<any>{return this.lstat(path);}

  setRemoteTimeOffsetInHours(offset: number) {
    this._remoteTimeOffsetInSeconds = offset * SECONDS_PER_HOUR;
    this._remoteTimeOffsetInMilliseconds = offset * MILLISECONDS_PER_HOUR;
  }

  getClient() {
    if (!this.client) {
      throw new Error('client not found!');
    }
    return this.client;
  }

  connect(connectOpetion: ConnectOption, config: RemoteClientConfig): Promise<void> {
    return this.client.connect(
      connectOpetion,
      config
    );
  }

  onDisconnected(cb: () => void) {
    this.client.onDisconnected(cb);
  }

  end() {
    this.client.end();
  }

  toLocalTime(remoteTimeMilliseconds: number): number {
    return remoteTimeMilliseconds - this._remoteTimeOffsetInMilliseconds;
  }

  toRemoteTimeInSecnonds(localtime: number): number {
    return localtime + this._remoteTimeOffsetInSeconds;
  }

  async readFile(path: string, option?: FileOption): Promise<string | Buffer> {
    return new Promise<string | Buffer>(async (resolve, reject) => {
      let stream: Readable;
      try {
        stream = await this.get(path, option);
      } catch (error) {
        return reject(error);
      }

      const arr: Buffer[] = [];
      const onData = (chunk: Buffer) => {
        arr.push(chunk);
      };
      const onEnd = (err?: Error) => {
        if (err) {
          return reject(err);
        }

        const buffer = Buffer.concat(arr);
        resolve(option && option.encoding ? buffer.toString(option.encoding) : buffer);
      };

      stream.on('data', onData);
      stream.on('error', onEnd);
      stream.on('end', onEnd);
    });
  }

  protected abstract _createClient(option: ConnectOption): any;
}
