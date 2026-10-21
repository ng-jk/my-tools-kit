import * as path from 'path';
interface Entry {root:string;done:Promise<void>;}
const pending=new Map<string,Entry[]>();
// Serialize overlapping destination trees, including separate command invocations.
// Disjoint destinations retain transfer concurrency.
export async function acquireUploadLock(config:any,remote:string,check:()=>void) {
 const identity=JSON.stringify([config.protocol,String(config.host||'').toLowerCase(),config.port,config.username]);
 const root=path.posix.resolve('/',remote.replace(/\\/g,'/')).toLowerCase();
 const entries=pending.get(identity)||[];pending.set(identity,entries);
 const overlap=(a:string,b:string)=>a===b||a.startsWith(b.endsWith('/')?b:b+'/')||b.startsWith(a.endsWith('/')?a:a+'/');
 const before=entries.filter(entry=>overlap(root,entry.root));
 let finish:()=>void;const entry={root,done:new Promise<void>(resolve=>finish=resolve)};entries.push(entry);
 let released=false;
 const release=()=>{if(released)return;released=true;finish!();entries.splice(entries.indexOf(entry),1);if(!entries.length)pending.delete(identity);};
 try{await Promise.all(before.map(item=>item.done));check();return release;}catch(error){release();throw error;}
}
