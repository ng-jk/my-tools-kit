// Git I/O adapter shared by the VS Code and terminal interfaces.
import * as fs from 'fs';
import * as path from 'path';
import {git as runGit} from '../git';

export async function findGitRoot(filepath: string): Promise<string | null> {
  let current = path.resolve(filepath);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
export async function readLog(dir: string, depth: number) {
  const output=(await runGit(dir,['log','-n',String(Math.max(1,Math.trunc(depth))),'--format=%H%x00%ct%x00%B%x00'])).toString('utf8').split('\0');
  const entries=[];
  for(let i=0;i+2<output.length;i+=3) entries.push({oid:output[i].trim(),commit:{message:output[i+2],author:{timestamp:Number(output[i+1])}}});
  return entries;
}
export async function readStatus(dir: string) {
  const output=(await runGit(dir,['status','--porcelain=v1','-z','--untracked-files=all','--no-renames'])).toString('utf8');
  const rows=new Map<string,any[]>();
  for(const record of output.split('\0').filter(Boolean)) {
    const name=record.slice(3),tracked=record.slice(0,2)!=='??';
    let present=true;
    try {fs.lstatSync(path.join(dir,name));} catch(error) {if(error.code!=='ENOENT')throw error;present=false;}
    rows.set(name,[name,tracked?1:0,present?2:0,0]);
  }
  return [...rows.values()];
}
export async function readCommitEntries(dir: string, revision: string) {
  const oid=(await runGit(dir,['rev-parse','--verify','--end-of-options',revision+'^{commit}'])).toString('utf8').trim();
  const ancestry=(await runGit(dir,['rev-list','--parents','-n','1',oid])).toString('utf8').trim().split(/\s+/);
  const args=['diff-tree','--root','--no-commit-id','--raw','--no-abbrev','--no-renames','-r','-z'];
  if(ancestry[1])args.push(ancestry[1]);args.push(oid,'--');
  const fields=(await runGit(dir,args)).toString('utf8').split('\0');const result=[];
  for(let i=0;i+1<fields.length;i+=2) {
    const values=fields[i].split(' '),mode=values[1],headOid=values[3];
    result.push({filepath:fields[i+1],headType:mode==='100644'||mode==='100755'||mode==='120000'?'blob':undefined,headOid,baseOid:values[2]});
  }
  return result;
}
