export interface GitChange {kind: 'upload' | 'rename' | 'delete'; path: string; oldPath?: string;}
export interface GitOperation {kind: 'upload' | 'rename' | 'delete'; path: string; oldPath?: string;}
export function planGitTransfers(changes: GitChange[], context: (path: string) => string | undefined): GitOperation[] {
  const renames: GitOperation[] = [], uploads = new Set<string>(), deletes = new Set<string>();
  for (const change of changes) {
    const destination = context(change.path);
    if (change.kind === 'rename') {
      const origin = change.oldPath && context(change.oldPath);
      if (origin && origin === destination) renames.push(change);
      else if (origin && change.oldPath) deletes.add(change.oldPath);
      if (destination) uploads.add(change.path);
    } else if (destination) {
      if (change.kind === 'delete') deletes.add(change.path); else uploads.add(change.path);
    }
  }
  for (const uploaded of uploads) deletes.delete(uploaded);
  return [...renames, ...Array.from(uploads, path => ({kind:'upload' as const,path})), ...Array.from(deletes, path => ({kind:'delete' as const,path}))];
}
export async function executeGitTransfers(plan: GitOperation[], adapter: {
  upload(path: string): Promise<unknown>; rename(from: string, to: string): Promise<unknown>; delete(path: string): Promise<unknown>;
}, backgroundConcurrency=1) {
  if(!Number.isInteger(backgroundConcurrency)||backgroundConcurrency<1||backgroundConcurrency>8)throw new Error('Background concurrency must be between 1 and 8');
  let index=0;
  while(index<plan.length){
    const operation=plan[index];
    if(operation.kind==='upload'){
      const uploads:GitOperation[]=[];
      while(index<plan.length&&plan[index].kind==='upload')uploads.push(plan[index++]);
      let next=0,stopped=false;
      // Overlap independent file chores. Each adapter retains its existing
      // verified-backup barrier and per-connection wire serialization. Never
      // start pending renames/deletions after an upload failure.
      const outcomes=await Promise.allSettled(Array.from({length:Math.min(backgroundConcurrency,uploads.length)},async()=>{
        while(next<uploads.length&&!stopped){const selected=uploads[next++];try{await adapter.upload(selected.path);}catch(error){stopped=true;throw error;}}
      }));
      const failed=outcomes.find(outcome=>outcome.status==='rejected');
      if(failed&&failed.status==='rejected')throw failed.reason;
    }else{
      index++;
      try {
        if(operation.kind==='rename')await adapter.rename(operation.oldPath!,operation.path);
        else await adapter.delete(operation.path);
      }catch(error){
        if(operation.kind==='rename'&&!error.missingRenameSource)throw error;
        if(error.code!=='ENOENT'&&error.code!==2)throw error;
      }
    }
  }
  return plan;
}

// SCM index and worktree states can disagree; transfers always send live files.
export function reconcileGitChanges(changes: GitChange[], exists: (path: string) => boolean): GitChange[] {
  return changes.flatMap(change => {
    const present = exists(change.path);
    if (change.kind === 'rename' && change.oldPath) {
      const oldPresent = exists(change.oldPath);
      if (present && !oldPresent) return [change];
      return [{kind: oldPresent ? 'upload' : 'delete', path: change.oldPath},
        {kind: present ? 'upload' : 'delete', path: change.path}] as GitChange[];
    }
    return [{kind: present ? 'upload' : 'delete', path: change.path}] as GitChange[];
  });
}
