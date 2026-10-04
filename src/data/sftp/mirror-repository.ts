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
  add(filepath: string) { return git.add({fs,dir:this.root,filepath}); }
  status(files: Set<string>) { return git.statusMatrix({fs,dir:this.root,filter:file=>files.has(file)}); }
  commit(message: string, author: {name:string;email:string}) { return git.commit({fs,dir:this.root,message,author}); }
}
