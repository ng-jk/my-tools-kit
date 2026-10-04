import * as fs from 'fs';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as git from 'isomorphic-git';
import {LocalFileSystem} from './core/fs';
export class MirrorRepository {
  readonly files: LocalFileSystem;
  constructor(readonly root: string) { this.files = new LocalFileSystem(path,root); }
  async initialize() {
    await fse.ensureDir(this.root);
    if (!await fse.pathExists(path.join(this.root,'.git'))) await git.init({fs,dir:this.root,defaultBranch:'main'});
  }
  add(filepath: string) { return git.add({fs,dir:this.root,filepath}); }
  status(files: Set<string>) { return git.statusMatrix({fs,dir:this.root,filter:file=>files.has(file)}); }
  commit(message: string, author: {name:string;email:string}) { return git.commit({fs,dir:this.root,message,author}); }
}
