import {FileSystem} from '../../data/sftp/core/fs';
// Lease whole file transfers, never simultaneous data commands on one FTP
// connection. Planning and verified backups complete before these workers run.
export async function createTransferConnections(primary:FileSystem,count:number,signal:AbortSignal,check:()=>void){
  if(!Number.isInteger(count)||count<1||count>8)throw new Error('FTP connection count must be between 1 and 8');
  const checkActive=()=>{check();if(signal.aborted)throw new Error('Transfer cancelled');};
  const peers:FileSystem[]=[];
  try{
    const results=await Promise.allSettled(Array.from({length:count-1},async()=>{
      checkActive();const peer=await (primary as any).createTransferConnection(signal);
      peers.push(peer);checkActive();return peer;
    }));
    const failed=results.find(result=>result.status==='rejected');if(failed&&failed.status==='rejected')throw failed.reason;
    checkActive();
  }catch(error){for(const peer of peers)(peer as any).end();throw error;}
  const available=[primary,...peers],waiters:Array<{resolve:(fs:FileSystem)=>void;reject:(error:Error)=>void}>=[];
  let closed=false;
  const abortWaiters=()=>{for(const waiter of waiters.splice(0))waiter.reject(new Error('Transfer cancelled'));};
  signal.addEventListener('abort',abortWaiters);
  return {
    acquire:async()=>{
      checkActive();if(closed)throw new Error('FTP transfer connections are closed');
      const fs=available.shift()||await new Promise<FileSystem>((resolve,reject)=>waiters.push({resolve,reject}));
      let released=false;
      return {fs,release:()=>{if(released)return;released=true;const next=waiters.shift();if(next)next.resolve(fs);else available.push(fs);}};
    },
    close:()=>{if(closed)return;closed=true;signal.removeEventListener('abort',abortWaiters);for(const waiter of waiters.splice(0))waiter.reject(new Error('FTP transfer connections are closed'));for(const peer of peers)(peer as any).end();},
    size:1+peers.length,
  };
}
