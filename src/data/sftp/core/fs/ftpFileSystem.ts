// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import PQueue from 'p-queue';
import { Readable } from 'stream';
import {randomUUID} from 'crypto';
import { logger } from '../../ports';
import { FileEntry, FileType, FileStats, FileOption } from './fileSystem';
import RemoteFileSystem from './remoteFileSystem';
import { FTPClient } from '../remote-client/index';
import { assertEntryName, checkedEntries } from '../../path-safety';
import {missingPathReply,mlstReportsPresence,statReportsPresence} from './ftp-metadata';

interface FtpFileHandle {
  path: string;
  flags: string;
  mode?: number;
  prepared?: boolean;
}

// Lowercase setuid/setgid/sticky markers include execute; uppercase do not.
// Use a fixed field order and never invent rights when Unix metadata is absent.
function toNumMode(rightObj: any) {
  if (!rightObj) return Number.NaN;
  let mode = 0;
  for (const key of ['user', 'group', 'other']) {
    const rights = rightObj[key];
    if (typeof rights !== 'string' || /[^rwxstST-]/.test(rights)) return Number.NaN;
    let bits = 0;
    if (rights.includes('r')) bits |= 4;
    if (rights.includes('w')) bits |= 2;
    if (/[xst]/.test(rights)) bits |= 1;
    mode = (mode << 3) | bits;
  }
  return mode;
}

export default class FTPFileSystem extends RemoteFileSystem {
  supportsExclusiveCreate = false;
  // LIST cannot prove completeness: servers may silently omit dotfiles.
  supportsCompleteDirectoryListing = false;
  private _supportMFMT: boolean = true;
  private metadataReaders=0;
  private isolationUsesListingOwner=false;
  private metadata=new Map<string,Promise<any[]>>();
  // Scoped to planning/backup only; every mutation invalidates the snapshot.
  beginMetadataReadScope() {
    this.metadataReaders++;
    let done=false;
    return ()=>{if(!done){done=true;this.metadataReaders--;this.metadata.clear();}};
  }
  private async mutation(task:()=>Promise<any>) {
    this.metadata.clear();
    try{return await task();}finally{this.metadata.clear();}
  }

  static getFileType(type: string) {
    if (type === 'd') {
      return FileType.Directory;
    } else if (type === '-') {
      return FileType.File;
    } else if (type === 'l') {
      return FileType.SymbolicLink;
    } else {
      return FileType.Unknown;
    }
  }

  private queue: any = new PQueue({ concurrency: 1 });

  get ftp() {
    return this.getClient().getFsClient();
  }

  toFileStat(stat: any): FileStats {
    const mtime = this.toLocalTime(stat.date.getTime());
    return {
      type: FTPFileSystem.getFileType(stat.type),
      uid: /^\d+$/.test(String(stat.owner)) && Number.isSafeInteger(Number(stat.owner)) ? Number(stat.owner) : undefined,
      owner: typeof stat.owner==='string' && /^[A-Za-z0-9_.@-]+$/.test(stat.owner) ? stat.owner : undefined,
      mode: toNumMode(stat.rights),
      size: stat.size,
      mtime,
      atime: mtime,
      target: stat.target,
    };
  }

  toFileEntry(fullPath: string, stat: any): FileEntry {
    assertEntryName(stat.name);
    return {
      fspath: fullPath,
      name: stat.name,
      ...this.toFileStat(stat),
    };
  }

  _createClient(option: any) {
    return new FTPClient(option);
  }

  async lstat(path: string): Promise<FileStats> {
    if (['.','./'].includes(this.pathResolver.normalize(path))) {
      const cwd = await this.queue.add(() => new Promise<string>((resolve,reject) => this.ftp.pwd((error,dir) => error ? reject(error) : resolve(dir))));
      if (!this.pathResolver.isAbsolute(cwd)) throw new Error('FTP server returned an invalid working directory');
      return this.lstat(cwd);
    }
    if (path === '/') {
      return {
        type: FileType.Directory,
        mode: 0o666,
        size: 0,
        mtime: 0,
        atime: 0,
      };
    }

    const parentPath = this.pathResolver.dirname(path);
    const nameIdentity = this.pathResolver.basename(path);
    let stats:FileEntry[];
    try{stats=await this.list(parentPath);}catch(error){if(Number(error.code)===550)return this.probePath(path);throw error;}

    let fileStat = stats.find(ns => ns.name === nameIdentity);
    if(!fileStat){
      try{fileStat=(await this.list(parentPath,{showHiddenFiles:true})).find(entry=>entry.name===nameIdentity);}
      catch(error){if(![500,501,502,504,550].includes(Number(error.code)))throw error;}
    }

    if (!fileStat) {
      return this.probePath(path);
    }

    return fileStat;
  }

  private async isolationFacts(path:string,requireMode:boolean):Promise<{uid:number;mode?:number}>{
    return this.queue.add(async()=>{
      const send=(command:string)=>new Promise<string>((resolve,reject)=>this.ftp._send(command,(error:any,reply:string)=>error?reject(error):resolve(reply||'')));
      const parse=(reply:string)=>{
        for(const line of reply.split(/\r?\n/)){
          const entry=/^\s*((?:[A-Za-z0-9._-]+=[^;\r\n]*;)+) (.+)$/.exec(line);
          if(!entry||entry[2]!==path)continue;
          const facts=entry[1].split(';').filter(Boolean),types=facts.filter(f=>/^type=/i.test(f)),modes=facts.filter(f=>/^unix\.mode=/i.test(f)),uids=facts.filter(f=>/^unix\.uid=/i.test(f));
          if(types.length>1||modes.length>1||uids.length>1)throw Object.assign(new Error('Ambiguous FTP ownership facts'),{code:'FTP_ISOLATION_AMBIGUOUS'});
          if(types.length!==1||!/^type=dir$/i.test(types[0])||uids.length!==1||!/^unix\.uid=\d+$/i.test(uids[0]))continue;
          const uid=Number(uids[0].split('=')[1]);if(!Number.isSafeInteger(uid)||uid<0)continue;
          const validMode=modes.length===1&&/^unix\.mode=[0-7]{3,4}$/i.test(modes[0]);
          if(requireMode&&!validMode)continue;
          return {uid,mode:validMode?parseInt(modes[0].split('=')[1],8)&0o777:undefined};
        }
      };
      let result=parse(await send('MLST '+path));
      if(result===undefined){await send('OPTS MLST type;UNIX.mode;UNIX.uid;');result=parse(await send('MLST '+path));}
      if(result===undefined)throw Object.assign(new Error('Required ownership/mode facts unavailable'),{code:'FTP_ISOLATION_UNAVAILABLE'});
      return result;
    }).catch(error=>{throw Object.assign(new Error('FTP permissions/ownership cannot be verified for safe uploads: '+path+'. '+error.message),{code:error.code});});
  }

  async parentIsolationStat(path:string):Promise<FileStats>{
    const normalized=this.pathResolver.normalize(path);
    if(normalized==='.'){
      const cwd=await this.queue.add(()=>new Promise<string>((resolve,reject)=>this.ftp.pwd((error:any,value:string)=>error?reject(error):resolve(value))));
      if(this.pathResolver.normalize(cwd)==='.')throw new Error('FTP cannot resolve current-directory ownership for safe uploads.');
      return this.parentIsolationStat(cwd);
    }
    if(normalized==='/'){
      try {
        const facts=await this.isolationFacts('/',true);
        this.isolationUsesListingOwner=false;
        return {type:FileType.Directory,uid:facts.uid,mode:facts.mode!,size:0,mtime:0,atime:0};
      } catch(error) {
        if(!['FTP_ISOLATION_UNAVAILABLE',500,501,502,504].includes(error.code))throw error;
        // Read only the root's own entry. Never infer its mode/owner from children
        // or '..', and never substitute the synthetic root used by read APIs.
        for(const command of ['-al /','/']) {
          let entries:any[];
          try {entries=await this.atomicList(command);}catch(listError){if([500,501,502,504,550].includes(Number(listError.code)))continue;throw listError;}
          if(!Array.isArray(entries))throw new Error('FTP root listing is unparseable; upload stopped.');
          const own=entries.filter(entry=>entry && (entry.name==='.'||entry.name==='/'));
          if(own.length>1)throw new Error('FTP root listing contains ambiguous self entries; upload stopped.');
          if(own.length===1){this.isolationUsesListingOwner=true;return this.toFileStat(own[0]);}
        }
        throw new Error('FTP permissions/ownership cannot be verified for safe uploads: /. The server supplies neither MLST UNIX.mode/UNIX.uid nor a Unix LIST self entry (.) for /. Ask the server administrator to enable one of these listing forms. No payload was uploaded.');
      }
    }
    const stat=await this.lstat(path);
    if(stat.type!==FileType.Directory||Number.isSafeInteger(stat.uid)||(this.isolationUsesListingOwner&&stat.owner))return stat;
    const facts=await this.isolationFacts(path,false);
    return {...stat,uid:facts.uid};
  }

  async lstatForBackup(path:string):Promise<FileStats> {return this.lstat(path);}

  private async probePath(path:string):Promise<FileStats> {
    const diagnostics:string[]=[];let reportedPresent=false;
    for(const command of ['MLST','STAT','RNFR']){
      let reply:string;
      try{reply=await this.queue.add(async()=>{
        try{return await new Promise<string>((resolve,reject)=>this.ftp._send(command+' '+path,(error:any,text:string)=>error?reject(error):resolve(text||'')));}
        finally{if(command==='RNFR')await new Promise<void>((resolve,reject)=>this.ftp._send('NOOP',(error:any)=>error?reject(error):resolve()));}
      });}
      catch(error){
        if(missingPathReply(error,path)){
          // Confirm missing metadata through the rename-side existence check:
          // an omitted/dangling link must not be treated as a new destination.
          if(command==='RNFR'){if(reportedPresent)throw new Error('FTP returned contradictory existence responses for '+path+'. Upload stopped without replacing the destination.');throw Object.assign(new Error('Remote path does not exist: '+path),{code:'ENOENT'});}
          diagnostics.push(command+' reported missing');continue;
        }
        // Some servers return transient 450 for metadata on a missing path.
        // It is not proof of absence: continue to RNFR, whose explicit missing
        // reply is still required. A 450 from RNFR must stop the transfer.
        const metadataUnavailable = command !== 'RNFR' && Number(error.code) === 450;
        if(command === 'RNFR' && Number(error.code) === 450)throw new Error('FTP could not inspect remote path '+path+' (RNFR, code 450). The server reports temporary unavailability; absence could not be confirmed. Upload stopped without replacing the destination. Check server availability and account access before retrying.');
        if(!metadataUnavailable && ![500,501,502,504,550].includes(Number(error.code)))throw new Error('FTP could not inspect remote path '+path+' ('+command+', code '+(error.code||'unknown')+'). Check the connection and server permissions.');
        diagnostics.push(command+' code '+error.code);continue;
      }
      if(command==='RNFR')throw new Error('FTP confirms that '+path+' exists, but cannot identify its file type/permissions for backup. Check listing/read permissions. No file was renamed.');
      const present=command==='MLST'?mlstReportsPresence(reply,path):statReportsPresence(reply,path);
      // MLST/STAT may describe a symlink referent: they establish presence,
      // never the non-following type needed for backup or ancestor traversal.
      if(present)reportedPresent=true;
      diagnostics.push(command+' cannot establish the entry own type');
    }
    throw new Error('FTP cannot establish destination type or absence for '+path+'. '+diagnostics.join('; ')+'. The server did not confirm that the path is missing; check listing/read permissions.');
  }

  async open(path: string, flags: string, mode?: number): Promise<FtpFileHandle> {
    if (!/[wa+]/.test(flags)) return {path,flags,mode};
    if (flags.includes('x')) {
      try { await this.lstat(path); throw new Error('FTP staging path already exists'); }
      catch(error) {if(error.code!=='ENOENT'&&error.code!==2)throw error;}
    }
    mode = mode === undefined ? 0o600 : mode;
    // FTP handles are logical; payload creation happens inside a private directory
    // in put(). STOR can recreate a file with server-default permissions.
    return {path,flags,mode,prepared:true};
  }

  private async verifyMode(path:string,mode:number,type=FileType.File) {
    const stat=await this.lstat(path);
    if(stat.type!==type)throw new Error('FTP staging entry has an unexpected file type');
    if ((stat.mode & 0o777) !== (mode & 0o777)) throw new Error('FTP server did not preserve required file permissions');
  }

  close(_fd: FtpFileHandle): Promise<void> {
    return Promise.resolve();
  }

  fstat(fd: FtpFileHandle): Promise<FileStats> {
    return this.lstat(fd.path);
  }

  futimes(fd: FtpFileHandle, _atime: number, mtime: number): Promise<void> {
    if (!this._supportMFMT) return Promise.resolve();

    return this.atomicSetLastMod(fd.path, new Date(mtime * 1000)).catch(_ => {
      logger.info('Don\'t Support MFMT');
      this._supportMFMT = false;
    });
  }

  async get(path: string, _option?: FileOption): Promise<Readable> {
    const stream = await this.atomicGet(path);

    if (!stream) {
      throw new Error('create ReadStream failed');
    }

    return stream;
  }

  async chmod(path: string, mode: number): Promise<void> {
    const command = `CHMOD ${mode.toString(8)} ${path}`;
    return await this.atomicSite(command);
  }

  async put(input: Readable, path: string, option?: FileOption): Promise<void> {
    let inputError:Error|undefined;
    const remember=(error:Error)=>{inputError=error;this.ftp.abort((err:any)=>{if(err)logger.warn('FTP abort failed');});};
    const checkSource=()=>{
      if(inputError)throw inputError;
      if(input.destroyed&&!input.readableEnded)throw new Error('Source stream closed before transfer completed');
    };
    input.on('error',remember);
    const directory=this.pathResolver.join(this.pathResolver.dirname(path),'upload.devkit-'+randomUUID()+'.upload');
    const payload=this.pathResolver.join(directory,'payload');
    let created=false;
    try {
      checkSource();
      const handle=option?.fd as FtpFileHandle|undefined;
      const prepared=handle?.prepared?handle:await this.open(path,'w',option?.mode);
      await this.mkdir(directory);created=true;
      await this.chmod(directory,0o700);await this.verifyMode(directory,0o700,FileType.Directory);
      checkSource();
      // No APPE or REST: even servers that recreate STOR files cannot expose
      // their contents through this verified owner-only parent directory.
      await this.atomicPut(input,payload);
      checkSource();
      await this.chmod(payload,prepared.mode!);await this.verifyMode(payload,prepared.mode!);
      checkSource();
      await this.renameAtomic(payload,path);
    } catch(error) {throw inputError||error;}
    finally {
      input.removeListener('error',remember);
      if(created){
        try{await this.unlink(payload);}catch(error){if(error.code!=='ENOENT'&&error.code!==2&&error.code!==550)logger.warn('FTP temporary payload cleanup failed: '+payload);}
        try{await this.rmdir(directory,false);}catch(error){logger.warn('FTP temporary directory retained after cleanup failure: '+directory);}
      }
    }
  }

  readlink(path: string): Promise<string> {
    return this.lstat(path).then(stat => stat.target!);
  }

  symlink(_targetPath: string, _path: string): Promise<void> {
    return Promise.reject(new Error('FTP does not support symbolic link creation'));
  }

  async mkdir(dir: string, _mode?: number): Promise<void> {
    return await this.atomicMakeDir(dir);
  }

  async ensureDir(dir: string): Promise<void> {
    return await this._ensureDir(dir, true);
  }

  async _ensureDir(dir: string, checkExistFirst: boolean): Promise<void> {
    // check if exist first.
    // `ls` command can't make sure to return dotfiles, so this not work for dotfiles,
    // cause ftp don't return distinct error code for dir not exists and dir exists
    if (checkExistFirst) {
      let stat;
      try {
        stat = await this.lstat(dir);
      } catch {
        // ignore error
      }

      if (stat) {
        if (stat.type !== FileType.Directory) {
          logger.error(`${dir} (type = ${stat.type})is not a directory`);
          throw new Error(`${dir} is not a valid directory path`);
        }

        return;
      }
    }

    let err;
    try {
      await this.mkdir(dir);
      return;
    } catch (error) {
      // avoid nested code block
      err = error;
    }

    switch (err.code) {
      case 550:
        // Hooray, exists!
        if (err.message.toLowerCase().indexOf('file exists') >= 0) {
          return;
        }

        const parentPath = this.pathResolver.dirname(dir);
        // We are trying to create the root dir, something must go wrong.
        if (parentPath === dir) {
          throw err;
        }

        // If goes here, we can assume the file doesn't exist
        await this._ensureDir(parentPath, false);
        await this.mkdir(dir);
        break;

      // In the case of any other error, just see if there's a dir
      // there already.  If so, then hooray!  If not, then something
      // is borked.
      default:
        try {
          const stat = await this.lstat(dir);
          if (stat.type !== FileType.Directory) throw err;
        } catch {
          // if the stat fails, then that's super weird.
          // let the original error be the failure reason
          throw err;
        }
        break;
    }
  }

  async list(
    dir: string,
    { showHiddenFiles = false } = {}
  ): Promise<FileEntry[]> {
    // -al flag only get partially support
    const key=(showHiddenFiles?'-al ':'')+this.pathResolver.normalize(dir);
    let pending=this.metadataReaders?this.metadata.get(key):undefined;
    if(!pending){pending=this.atomicList((showHiddenFiles?'-al ':'')+dir);if(this.metadataReaders){this.metadata.set(key,pending);pending.catch(()=>{if(this.metadata.get(key)===pending)this.metadata.delete(key);});}}
    const stats = await pending;
    if (!Array.isArray(stats) || stats.some(item => !item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name)) {
      throw new Error('FTP listing contains unparseable entries; refusing an incomplete directory snapshot');
    }

    return (
      stats
        .filter(item => item.name && item.name !== '.' && item.name !== '..')
        .map(item =>
          this.toFileEntry(this.pathResolver.join(dir, item.name), item)
        )
    );
  }

  async unlink(path: string): Promise<void> {
    return await this.atomicDeleteFile(path);
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    if (recursive) {
      const entries = checkedEntries(this, path, await this.list(path));
      for (const entry of entries) {
        if (entry.type === FileType.Directory) await this.rmdir(entry.fspath, true);
        else await this.unlink(entry.fspath);
      }
    }
    return await this.atomicRemoveDir(path, false);
  }

  async rename(srcPath: string, destPath: string): Promise<void> {
    return await this.renameAtomic(srcPath, destPath);
  }

  async renameAtomic(srcPath: string, destPath: string): Promise<void> {
    const task = () =>
      new Promise<void>((resolve, reject) => {
        this.ftp.rename(srcPath, destPath, (err: any) => {
          if (err) {
            return reject(err);
          }

          resolve();
        });
      });

    return this.queue.add(()=>this.mutation(task));
  }

  private async atomicList(path: string): Promise<any[]> {
    const task = () =>
      new Promise<any[]>((resolve, reject) => {
        this.ftp.list(path, (err: any, stats: any[]) => {
          if (err) {
            return reject(err);
          }

          resolve(stats || []);
        });
      });

    return this.queue.add(task);
  }

  private async atomicGet(path: string): Promise<Readable> {
    const task = () =>
      new Promise<Readable>((resolve, reject) => {
        this.ftp.get(path, (err: any, stream: Readable) => {
          if (err) {
            return reject(err);
          }

          resolve(stream);
        });
      });

    return this.queue.add(task);
  }

  private async atomicPut(input: Readable, path: string): Promise<void> {
    const task = () =>
      new Promise<void>((resolve, reject) => {
        this.ftp.put(input, path, (err: any) => {
          if (err) {
            return reject(err);
          }

          resolve();
        });
      });

    return this.queue.add(()=>this.mutation(task));
  }

  private async atomicDeleteFile(path: string): Promise<void> {
    const task = () =>
      new Promise<void>((resolve, reject) => {
        this.ftp.delete(path, (err: any) => {
          if (err) {
            return reject(err);
          }

          resolve();
        });
      });

    return this.queue.add(()=>this.mutation(task));
  }

  private async atomicMakeDir(path: string): Promise<void> {
    const task = () =>
      new Promise<void>((resolve, reject) => {
        this.ftp.mkdir(path, (err: any) => {
          if (err) {
            return reject(err);
          }

          resolve();
        });
      });

    return this.queue.add(()=>this.mutation(task));
  }

  private async atomicRemoveDir(
    path: string,
    recursive: boolean
  ): Promise<void> {
    const task = () =>
      new Promise<void>((resolve, reject) => {
        this.ftp.rmdir(path, recursive, (err: any) => {
          if (err) {
            return reject(err);
          }

          resolve();
        });
      });

    return this.queue.add(()=>this.mutation(task));
  }

  private async atomicSite(command: string): Promise<void> {
    const task = () =>
      new Promise<void>((resolve, reject) => {
        this.ftp.site(command, (err: any) => {
          if (err) {
            return reject(err);
          }

          resolve();
        });
      });

    return this.queue.add(()=>this.mutation(task));
  }

  private async atomicSetLastMod(path: string, date: Date): Promise<void> {
    const task = () =>
      new Promise<void>((resolve, reject) => {
        this.ftp.setLastMod(path, date, (err: any) => {
          if (err) {
            return reject(err);
          }

          resolve();
        });
      });

    return this.queue.add(()=>this.mutation(task));
  }
}
