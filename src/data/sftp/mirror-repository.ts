import * as fs from 'fs';
import {protectWindowsTree} from './windows-directory-permissions';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as git from 'isomorphic-git';
import {LocalFileSystem} from './core/fs';
export class MirrorRepository {
  readonly files: LocalFileSystem;
  constructor(readonly root: string) { this.files = new LocalFileSystem(path,root); }
  async initialize() {
    await fse.ensureDir(this.root);
    if ((await fse.lstat(this.root)).isSymbolicLink()) throw new Error('Mirror root must not be a link');
    if (process.platform === 'win32') await protectWindowsTree(this.root);
    else {
      await fse.chmod(this.root,0o700);
      if (((await fse.lstat(this.root)).mode & 0o777) !== 0o700) throw new Error('Cannot establish private mirror permissions');
      const check = async (directory: string) => {for (const name of await fse.readdir(directory)) {
        const entry=path.join(directory,name),stat=await fse.lstat(entry);
        if(stat.isSymbolicLink()) throw new Error('Mirror repository contains a link');
        if(stat.isDirectory()) await check(entry);
      }};
      await check(this.root);
    }
    if (!await fse.pathExists(path.join(this.root,'.git'))) await git.init({fs,dir:this.root,defaultBranch:'main'});
  }
  async prepareFile(filepath:string) {
    const root=path.resolve(this.root),absolute=path.resolve(root,filepath),relative=path.relative(root,absolute);
    if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||relative.split(path.sep).some(part=>part.toLowerCase()==='.git'))throw new Error('Unsafe backup working path');
    const normalized=relative.split(path.sep).join('/');
    for(const file of await git.listFiles({fs,dir:this.root})){
      if(file.startsWith(normalized+'/')||normalized.startsWith(file+'/'))await git.remove({fs,dir:this.root,filepath:file});
    }
    let current=root;
    const parts=relative.split(path.sep);
    for(let i=0;i<parts.length;i++){
      current=path.join(current,parts[i]);let stat;
      try{stat=await fse.lstat(current);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(stat?.isSymbolicLink())throw new Error('Backup working tree contains a link');
      const parent=i<parts.length-1;
      if(stat&&(parent?!stat.isDirectory():stat.isDirectory())){
        // The resolved path is checked above; .git and the repository root are excluded.
        await fse.remove(current);
      }
      if(parent)await this.files.ensureDir(current);
    }
  }
  async stageLink(filepath:string,target:string) {
    // Git stores link text with mode 120000; never create/follow a local link.
    const local=path.join(this.root,filepath);
    try{await this.files.unlink(local);}catch(error){if(error.code!=='ENOENT')throw error;}
    const oid=await git.writeBlob({fs,dir:this.root,blob:Buffer.from(target,'utf8')});
    await git.updateIndex({fs,dir:this.root,filepath,oid,mode:0o120000,add:true});
  }
  add(filepath: string) { return git.add({fs,dir:this.root,filepath,force:true}); }
  async verify(files:Set<string>,links:Map<string,string>) {
    const oid=await git.resolveRef({fs,dir:this.root,ref:'HEAD'});
    for(const file of [...files,...links.keys()]){
      const expected=links.has(file)?Buffer.from(links.get(file)!,'utf8'):await fse.readFile(path.join(this.root,file));
      const saved=await git.readBlob({fs,dir:this.root,oid,filepath:file});
      if(!Buffer.from(saved.blob).equals(expected))throw new Error('Backup commit verification failed: '+file);
      if(links.has(file)){
        const parent=path.posix.dirname(file);
        const tree=await git.readTree({fs,dir:this.root,oid,...(parent==='.'?{}:{filepath:parent})});
        if(tree.tree.find(entry=>entry.path===path.posix.basename(file))?.mode!=='120000')throw new Error('Backup link mode verification failed: '+file);
      }
    }
  }
  status(files: Set<string>) { return git.statusMatrix({fs,dir:this.root,filter:file=>files.has(file)}); }
  commit(message: string, author: {name:string;email:string}) { return git.commit({fs,dir:this.root,message,author}); }
}
