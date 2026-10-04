'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const engine = require('../build/sftp/engine');
function fixture(t, extra={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-sftp-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const local=path.join(dir,'local'),remote=path.join(dir,'remote');
  fs.mkdirSync(local);fs.mkdirSync(remote);
  const raw={host:'fixture',username:'fixture',protocol:'local',remotePath:remote.replaceAll('\\','/'),ignore:['ignored.txt'],...extra};
  const session=engine.createSession(local,raw);t.after(()=>session.service.dispose());
  return {dir,local,remote,raw,session};
}
test('shared engine uploads/downloads nested files, ignores patterns, compares and creates remote files',async t=>{
  const {local,remote,session}=fixture(t);
  fs.mkdirSync(path.join(local,'nested'));fs.writeFileSync(path.join(local,'nested','a.txt'),'original');fs.writeFileSync(path.join(local,'ignored.txt'),'ignore');
  const uploaded=await engine.operate(session,'upload');assert.equal(uploaded.passed,true);
  assert.equal(fs.readFileSync(path.join(remote,'nested','a.txt'),'utf8'),'original');assert.equal(fs.existsSync(path.join(remote,'ignored.txt')),false);
  fs.writeFileSync(path.join(remote,'nested','a.txt'),'remote edit');await engine.operate(session,'download','nested/a.txt');
  assert.equal(fs.readFileSync(path.join(local,'nested','a.txt'),'utf8'),'remote edit');
  assert.deepEqual(await engine.operate(session,'diff','nested/a.txt'),{local:'remote edit',remote:'remote edit'});
  await engine.operate(session,'mkdir','created');await engine.operate(session,'create','created/new.txt');
  await assert.rejects(engine.operate(session,'create','created/new.txt'),/exists/);
  await engine.operate(session,'rename','created/new.txt',{to:'created/renamed.txt'});
  assert.equal(fs.existsSync(path.join(remote,'created','renamed.txt')),true);
});
test('sync awaits deletion and never treats an unreadable source as empty',async t=>{
  const {local,remote,session}=fixture(t,{syncOption:{delete:true}});
  fs.writeFileSync(path.join(local,'a.txt'),'new');fs.writeFileSync(path.join(remote,'extra.txt'),'extra');
  await assert.rejects(engine.operate(session,'sync-up'),/requires --yes/);
  await engine.operate(session,'sync-up','.',{yes:true});assert.equal(fs.existsSync(path.join(remote,'extra.txt')),false);
  const source=session.service.getLocalFileSystem();const original=source.list;
  source.list=async()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});};
  try {await assert.rejects(engine.operate(session,'sync-up','.',{yes:true}),/denied/);assert.equal(fs.existsSync(path.join(remote,'a.txt')),true);} finally {source.list=original;}
});
test('profile contexts and temp upload preserve configuration behavior',async t=>{
  const {local,remote,raw}=fixture(t);
  fs.mkdirSync(path.join(local,'nested'));fs.writeFileSync(path.join(local,'nested','a.txt'),'temp');
  const session=engine.createSession(local,{...raw,profiles:{dev:{context:'nested',useTempFile:true}},defaultProfile:'dev'});
  t.after(()=>session.service.dispose());assert.equal(session.service.baseDir,path.join(local,'nested'));
  await engine.operate(session,'upload','a.txt');assert.equal(fs.readFileSync(path.join(remote,'a.txt'),'utf8'),'temp');
  assert.equal(fs.existsSync(path.join(remote,'a.txt.new')),false);
  assert.throws(()=>engine.createSession(local,raw,'missing'),/Unknown profile/);
});
test('failed scheduled transfer rejects and path traversal cannot escape context',async t=>{
  const {local,session}=fixture(t);fs.writeFileSync(path.join(local,'a.txt'),'x');
  const target=await session.service.getRemoteFileSystem(session.config);const original=target.put;
  target.put=async()=>{throw new Error('network disconnected');};
  try {await assert.rejects(engine.operate(session,'upload','a.txt'),/network disconnected/);} finally {target.put=original;}
  await assert.rejects(engine.operate(session,'upload','../outside'),/relative/);
  await assert.rejects(engine.operate(session,'delete','.' ,{yes:true}),/non-root/);
  for (const name of ['./','./.','folder/..','']) {
    await assert.rejects(engine.operate(session,'delete',name,{yes:true}),/non-root/);
    await assert.rejects(engine.operate(session,'rename',name,{to:'new'}),/non-root/);
  }
});
test('downloads cannot write outside the local context through links',async t=>{
  const {dir,local,remote,session}=fixture(t);
  const outside=path.join(dir,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'secret.txt'),'unchanged');
  const localFs=session.service.getLocalFileSystem();
  assert.throws(()=>localFs.symlink('../outside/secret.txt',path.join(local,'escape')),/escapes/);
  fs.symlinkSync(outside,path.join(local,'linked'),'junction');
  fs.mkdirSync(path.join(remote,'linked'));fs.writeFileSync(path.join(remote,'linked','secret.txt'),'overwrite');
  for(let attempt=0;attempt<2;attempt++) await assert.rejects(engine.operate(session,'download','linked/secret.txt'),/symlink/);
  assert.equal(fs.readFileSync(path.join(outside,'secret.txt'),'utf8'),'unchanged');
});
test('host keys reject unknown/changed/revoked keys and support pins and hashed known_hosts',t=>{
  const {dir}=fixture(t);const crypto=require('node:crypto');
  const key=Buffer.from('public-host-key'),changed=Buffer.from('changed-key'),file=path.join(dir,'known_hosts');
  const config={host:'example.test',port:2222,knownHostsPath:file};
  assert.equal(engine.verifyHostKey(config,key),false);
  assert.equal(engine.verifyHostKey({...config,hostFingerprint:engine.fingerprint(key)},key),true);
  assert.equal(engine.verifyHostKey({...config,hostFingerprint:engine.fingerprint(key)},changed),false);
  fs.writeFileSync(file,'[example.test]:2222 ssh-ed25519 '+key.toString('base64')+'\n');
  assert.equal(engine.verifyHostKey(config,key),true);assert.equal(engine.verifyHostKey(config,changed),false);
  fs.appendFileSync(file,'@revoked [example.test]:2222 ssh-ed25519 '+key.toString('base64')+'\n');assert.equal(engine.verifyHostKey(config,key),false);
  const salt=crypto.randomBytes(20),hash=crypto.createHmac('sha1',salt).update('[example.test]:2222').digest('base64');
  fs.writeFileSync(file,'|1|'+salt.toString('base64')+'|'+hash+' ssh-ed25519 '+key.toString('base64')+'\n');
  assert.equal(engine.verifyHostKey(config,key),true);
});
test('SSH terminal puts options before the host and remote commands after it without a local shell',()=>{
  const args=engine.sshArguments({protocol:'sftp',host:'example.test',username:'deploy',port:22,remotePath:'/project',sshCustomParams:'-o ServerAliveInterval=30 "cd ${remotePath}; exec bash"'});
  assert.deepEqual(args,['-t','-p','22','-o','StrictHostKeyChecking=yes','-o','ServerAliveInterval=30','--','deploy@example.test','cd /project; exec bash']);
  assert.throws(()=>engine.sshArguments({protocol:'sftp',host:'example.test',hostFingerprint:'SHA256:x'}),/cannot enforce/);
  assert.throws(()=>engine.sshArguments({protocol:'sftp',hop:{host:'jump'}}),/hop trust/);
  assert.ok(engine.sshArguments({protocol:'sftp',host:'example.test',username:'deploy',knownHostsPath:'C:/My Keys/known_hosts'}).includes('UserKnownHostsFile="C:/My Keys/known_hosts"'));
});
test('malicious directory entries cannot schedule writes outside the destination',async()=>{
  for (const name of ['../../outside.txt','../escape','nested/file','nested\\file','C:stream','.. ','bad\r\nDELE victim','bad\nname']) {
    const source={pathResolver:path.posix,lstat:async()=>({type:engine.FileType.Directory}),list:async()=>[{name,fspath:'/server/'+name,type:engine.FileType.File}]};
    const target={pathResolver:path.posix,lstat:async()=>({type:engine.FileType.Directory}),ensureDir:async()=>{}};
    const tasks=[];
    await assert.rejects(engine.transfer({srcFsPath:'/server',targetFsPath:'/workspace/project',srcFs:source,targetFs:target,transferDirection:engine.TransferDirection.REMOTE_TO_LOCAL,transferOption:{}},task=>tasks.push(task)),/Unsafe|escapes/);
    assert.equal(tasks.length,0);
  }
});
test('FTP recursive removal rejects malicious listings before deleting anything',async()=>{
  for(const name of ['../../victim.txt','/outside.txt','bad\r\nDELE victim']) {
    const removed=[];
    const ftp={list:(_,cb)=>cb(null,[{name,type:'-',date:new Date(),size:1}]),delete:(name,cb)=>{removed.push(name);cb();},rmdir:(name,recursive,cb)=>{removed.push(name);cb();}};
    const adapter=new engine.FTPFileSystem(path.posix,{client:{getFsClient:()=>ftp}});
    await assert.rejects(adapter.rmdir('/project/folder',true),/Unsafe|escapes/);assert.deepEqual(removed,[]);
  }
});
test('downloads ignore configured upload file and directory permission overrides',async t=>{
  const {local,remote,session}=fixture(t,{filePerm:644,dirPerm:755});
  fs.writeFileSync(path.join(local,'private.txt'),'original');fs.writeFileSync(path.join(remote,'private.txt'),'remote');
  const adapter=session.service.getLocalFileSystem(),lstat=adapter.lstat,open=adapter.open,chmod=adapter.chmod;const modes=[];let chmods=0;
  adapter.lstat=async name=>({...await lstat.call(adapter,name),mode:0o600});
  adapter.open=async(name,flags,mode)=>{modes.push(mode);return open.call(adapter,name,flags,mode);};adapter.chmod=async()=>{chmods++;};
  try {await engine.operate(session,'download');assert.ok(modes.includes(0o600));assert.equal(modes.includes(0o644),false);assert.equal(chmods,0);}
  finally{adapter.lstat=lstat;adapter.open=open;adapter.chmod=chmod;}
});
test('bidirectional sync rejects both file/directory conflict orientations',async()=>{
  for(const [left,right] of [[engine.FileType.File,engine.FileType.Directory],[engine.FileType.Directory,engine.FileType.File]]) {
    const source={pathResolver:path.posix,list:async()=>[{name:'conflict',fspath:'/source/conflict',type:left,mtime:1}]};
    const target={pathResolver:path.posix,lstat:async()=>({type:engine.FileType.Directory}),ensureDir:async()=>{},list:async()=>[{name:'conflict',fspath:'/destination/conflict',type:right,mtime:2}]};
    const tasks=[];
    await assert.rejects(engine.sync({srcFsPath:'/source',targetFsPath:'/destination',srcFs:source,targetFs:target,transferDirection:engine.TransferDirection.LOCAL_TO_REMOTE,transferOption:{bothDiretions:true}},task=>tasks.push(task)),/type conflict/);
    assert.equal(tasks.length,0);
  }
});
test('excluded file/directory conflicts do not abort sync',async()=>{
  for(const direction of [engine.TransferDirection.LOCAL_TO_REMOTE,engine.TransferDirection.REMOTE_TO_LOCAL]) {
    const source={pathResolver:path.posix,list:async()=>[{name:'ignored',fspath:'/source/ignored',type:engine.FileType.File}]};
    const target={pathResolver:path.posix,lstat:async()=>({type:engine.FileType.Directory}),ensureDir:async()=>{},list:async()=>[{name:'ignored',fspath:'/destination/ignored',type:engine.FileType.Directory}]};
    for(const policy of [{ignore:file=>file.endsWith('/ignored')},{ignoreExisting:true}]) {
      const tasks=[];await engine.sync({srcFsPath:'/source',targetFsPath:'/destination',srcFs:source,targetFs:target,transferDirection:direction,transferOption:policy},task=>tasks.push(task));assert.equal(tasks.length,0);
    }
  }
});
test('source failure during protocol permission checks rejects instead of hanging',{timeout:1000},async()=>{
  for(const protocol of ['sftp','ftp']) {
    const stream=new (require('node:stream').Readable)({read(){}});let payloads=0;
    const adapter=protocol==='sftp'?new engine.SFTPFileSystem(path.posix,{client:{}}):new engine.FTPFileSystem(path.posix,{client:{getFsClient:()=>({abort:cb=>cb()})}});
    const fail=async()=>{stream.destroy(new Error('source failed during permissions'));await new Promise(setImmediate);};
    if(protocol==='sftp') {adapter.fchmod=fail;adapter.fstat=async()=>({mode:0o600});adapter._put=async()=>{payloads++;};}
    else {adapter.verifyMode=fail;adapter.atomicAppend=async()=>{payloads++;};}
    await assert.rejects(adapter.put(stream,'/target',{mode:0o600,fd:{handle:Buffer.from('h'),path:'/target',prepared:true,mode:0o600}}),/source failed during permissions/);
    assert.equal(payloads,0);
  }
});
test('sync preserves symbolic link identity without reading linked file contents',async()=>{
  const source={pathResolver:path.posix,list:async()=>[{name:'link',fspath:'/local/link',type:engine.FileType.SymbolicLink,mtime:1,atime:1}],readlink:async()=>'../../private/key',get:async()=>{throw new Error('must not dereference');}};
  let link;
  const target={pathResolver:path.posix,lstat:async()=>({type:engine.FileType.Directory}),ensureDir:async()=>{},list:async()=>[],lstat:async name=>{if(name==='/remote')return {type:engine.FileType.Directory};throw Object.assign(new Error('missing'),{code:'ENOENT'});},unlink:async()=>{},rename:async(_,destination)=>{link.destination=destination;},symlink:async(value,destination)=>{link={value,destination};}};
  const tasks=[];
  await engine.sync({srcFsPath:'/local',targetFsPath:'/remote',srcFs:source,targetFs:target,transferDirection:engine.TransferDirection.LOCAL_TO_REMOTE,transferOption:{}},task=>tasks.push(task));
  assert.equal(tasks.length,1);assert.equal(tasks[0].fileType,engine.FileType.SymbolicLink);
  await tasks[0].run();assert.deepEqual(link,{value:'../../private/key',destination:'/remote/link'});
});
test('failed transfers preserve destinations and close staging handles',async t=>{
  const {local,remote,session}=fixture(t);fs.writeFileSync(path.join(local,'a.txt'),'replacement');fs.writeFileSync(path.join(remote,'a.txt'),'original');
  const source=session.service.getLocalFileSystem(),target=await session.service.getRemoteFileSystem(session.config);
  const get=source.get,put=target.put,close=target.close,rename=target.rename;let closes=0;
  target.close=async(...args)=>{closes++;return close.apply(target,args);};
  try {
    source.get=async()=>{throw new Error('source denied');};
    await assert.rejects(engine.operate(session,'upload','a.txt'),/source denied/);
    assert.equal(closes,0);assert.equal(fs.readFileSync(path.join(remote,'a.txt'),'utf8'),'original');
    source.get=async()=>new (require('node:stream').Readable)({read(){this.destroy(new Error('source stream failed'));}});
    await assert.rejects(engine.operate(session,'upload','a.txt'),/source stream failed/);
    assert.equal(fs.readFileSync(path.join(remote,'a.txt'),'utf8'),'original');
    const closedBefore=closes;
    source.get=get;target.put=async()=>{throw new Error('mid-transfer failure');};
    await assert.rejects(engine.operate(session,'upload','a.txt'),/mid-transfer/);
    assert.equal(closes,closedBefore+1);assert.equal(fs.readFileSync(path.join(remote,'a.txt'),'utf8'),'original');
    target.put=put;target.rename=async(a,b)=>{if(a.includes('.devkit-')&&!a.endsWith('.backup')&&b.endsWith('a.txt'))throw new Error('rename denied');return rename.call(target,a,b);};
    await assert.rejects(engine.operate(session,'upload','a.txt'),/rename denied/);
    assert.equal(fs.readFileSync(path.join(remote,'a.txt'),'utf8'),'original');
    assert.deepEqual(fs.readdirSync(remote),['a.txt']);
  } finally {source.get=get;target.put=put;target.close=close;target.rename=rename;}
});
test('internal staging and recovery files are excluded from automatic transfers',async t=>{
  const {local,remote,session}=fixture(t,{ignore:[]});
  const staged='a.txt.devkit-12345678-1234-1234-1234-123456789abc';
  for(const name of [staged,staged+'.backup']) {fs.writeFileSync(path.join(local,name),'internal');assert.equal(session.config.ignore(path.join(local,name)),true);}
  fs.writeFileSync(path.join(local,'a.txt'),'user content');
  await engine.operate(session,'upload');assert.deepEqual(fs.readdirSync(remote),['a.txt']);
});
test('default project uploads exclude credentials and repository metadata',async t=>{
  const {local,remote,session}=fixture(t,{ignore:undefined});
  for(const name of ['.git','.vscode']) {fs.mkdirSync(path.join(local,name));fs.writeFileSync(path.join(local,name,'secret'),'private');}
  fs.writeFileSync(path.join(local,'.env'),'SECRET=private');fs.writeFileSync(path.join(local,'.env.local'),'SECRET=private');fs.writeFileSync(path.join(local,'public.txt'),'public');
  await engine.operate(session,'upload');assert.deepEqual(fs.readdirSync(remote),['public.txt']);
});
test('recursive transfers retain each child permission mode in both directions',async()=>{
  for(const direction of [engine.TransferDirection.LOCAL_TO_REMOTE,engine.TransferDirection.REMOTE_TO_LOCAL]) {
    const created=[];
    const source={pathResolver:path.posix,lstat:async()=>({type:engine.FileType.Directory,mode:0o755}),list:async()=>[
      {name:'private',fspath:'/source/private',type:engine.FileType.File,mode:0o600},
      {name:'executable',fspath:'/source/executable',type:engine.FileType.File,mode:0o755}],get:async()=>require('node:stream').Readable.from('content')};
    const target={pathResolver:path.posix,ensureDir:async()=>{},lstat:async name=>{if(name==='/destination')return {type:engine.FileType.Directory};throw Object.assign(new Error('missing'),{code:2});},open:async(name,flags,mode)=>{created.push(mode);return 1;},put:async input=>{for await(const chunk of input){}},close:async()=>{},rename:async()=>{},unlink:async()=>{}};
    const tasks=[];
    await engine.transfer({srcFsPath:'/source',targetFsPath:'/destination',srcFs:source,targetFs:target,transferDirection:direction,transferOption:{}},task=>tasks.push(task));
    for(const task of tasks)await task.run();assert.deepEqual(created.sort(),[0o600,0o755]);
  }
});
test('sync compares equal-length symlink targets even with identical timestamps',async()=>{
  const entry=(fspath,type=engine.FileType.SymbolicLink)=>({name:'link',fspath,type,size:3,mtime:1000,atime:1000});
  let reads=0;
  const source={pathResolver:path.posix,list:async()=>[entry('/source/link')],readlink:async()=>{reads++;return 'one';}};
  const target={pathResolver:path.posix,lstat:async()=>({type:engine.FileType.Directory}),ensureDir:async()=>{},list:async()=>[entry('/destination/link')],readlink:async()=>{reads++;return 'two';}};
  let tasks=[];
  await engine.sync({srcFsPath:'/source',targetFsPath:'/destination',srcFs:source,targetFs:target,transferDirection:engine.TransferDirection.LOCAL_TO_REMOTE,transferOption:{}},task=>tasks.push(task));
  assert.equal(tasks.length,1);assert.equal(reads,2);
  target.list=async()=>[entry('/destination/link',engine.FileType.File)];tasks=[];
  await engine.sync({srcFsPath:'/source',targetFsPath:'/destination',srcFs:source,targetFs:target,transferDirection:engine.TransferDirection.LOCAL_TO_REMOTE,transferOption:{}},task=>tasks.push(task));assert.equal(tasks.length,1);
});
test('sync replacing a symlink with a file uses source permissions rather than link permissions',async()=>{
  let createdMode;
  const source={pathResolver:path.posix,list:async()=>[{name:'private',fspath:'/source/private',type:engine.FileType.File,mode:0o600,size:3,mtime:1}],get:async()=>require('node:stream').Readable.from('secret')};
  const target={pathResolver:path.posix,lstat:async()=>({type:engine.FileType.Directory}),ensureDir:async()=>{},list:async()=>[{name:'private',fspath:'/destination/private',type:engine.FileType.SymbolicLink,mode:0o777,size:3,mtime:1}],lstat:async()=>({type:engine.FileType.SymbolicLink,mode:0o777}),open:async(_,flags,mode)=>{createdMode=mode;return 1;},put:async input=>{for await(const chunk of input){}},close:async()=>{},rename:async()=>{},unlink:async()=>{}};
  const tasks=[];
  await engine.sync({srcFsPath:'/source',targetFsPath:'/destination',srcFs:source,targetFs:target,transferDirection:engine.TransferDirection.REMOTE_TO_LOCAL,transferOption:{}},task=>tasks.push(task));
  assert.equal(tasks.length,1);await tasks[0].run();assert.equal(createdMode,0o600);
});
test('staged downloads preserve restrictive and executable modes, with source fallback for new files',async()=>{
  for(const [existing,fallback,expected] of [[0o600,0o644,0o600],[0o755,0o644,0o755],[undefined,0o640,0o640]]) {
    let createdMode;
    const source={get:async()=>require('node:stream').Readable.from('content')};
    const target={lstat:async()=>{if(existing===undefined)throw Object.assign(new Error('missing'),{code:2});return {type:engine.FileType.File,mode:existing};},open:async(_,flags,mode)=>{createdMode=mode;return 1;},put:async input=>{for await(const chunk of input){}},close:async()=>{},rename:async()=>{},unlink:async()=>{}};
    await new engine.TransferTask({fsPath:'/source',fileSystem:source},{fsPath:'/destination',fileSystem:target},{fileType:engine.FileType.File,transferDirection:engine.TransferDirection.REMOTE_TO_LOCAL,transferOption:{fallbackMode:fallback,perserveTargetMode:false}}).run();
    assert.equal(createdMode,expected);
  }
});
test('changed symlinks are replaced and permission errors fail the transfer',async()=>{
  const source={readlink:async()=>'new-target'},entries=new Map([['/target','old-target']]);
  const target={symlink:async(value,name)=>entries.set(name,value),lstat:async name=>{if(!entries.has(name))throw Object.assign(new Error('missing'),{code:2});return {type:engine.FileType.SymbolicLink};},rename:async(a,b)=>{entries.set(b,entries.get(a));entries.delete(a);},unlink:async name=>entries.delete(name)};
  const task=()=>new engine.TransferTask({fsPath:'/source',fileSystem:source},{fsPath:'/target',fileSystem:target},{fileType:engine.FileType.SymbolicLink,transferDirection:engine.TransferDirection.LOCAL_TO_REMOTE,transferOption:{}});
  await task().run();assert.equal(entries.get('/target'),'new-target');assert.equal(entries.size,1);
  target.symlink=async()=>{throw Object.assign(new Error('permission denied'),{code:4});};
  await assert.rejects(task().run(),/permission denied/);assert.equal(entries.get('/target'),'new-target');
});
test('shared Git selection includes root commits and CLI uses the same selection',async t=>{
  const {local,remote,raw}=fixture(t);
  const git=(...args)=>{const result=spawnSync('git',['-c','safe.directory='+local.replaceAll('\\','/'),...args],{cwd:local,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');
  fs.writeFileSync(path.join(local,'root.txt'),'root commit');git('add','root.txt');git('commit','-m','root');
  assert.deepEqual(await engine.getCommitChangedFiles(local,'HEAD'),['root.txt']);
  fs.mkdirSync(path.join(local,'.vscode'));fs.writeFileSync(path.join(local,'.vscode','sftp.json'),JSON.stringify(raw));
  const result=spawnSync(process.execPath,[path.resolve('cli.js'),'sftp','upload-commit',local,'--commit','HEAD'],{encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(path.join(remote,'root.txt'),'utf8'),'root commit');
  fs.writeFileSync(path.join(local,'root.txt'),'modified');fs.writeFileSync(path.join(local,'new.txt'),'new');
  const selected=await engine.getUncommittedChangedFiles(local);assert.ok(selected.includes('root.txt'));assert.ok(selected.includes('new.txt'));
  fs.unlinkSync(path.join(local,'root.txt'));
  const cli=(...args)=>spawnSync(process.execPath,[path.resolve('cli.js'),'sftp','upload-changed',local,...args],{encoding:'utf8',timeout:20000});
  assert.equal(cli().status,1,'deletions require explicit CLI acknowledgement');
  const changed=cli('--yes');assert.equal(changed.status,0,changed.stderr);
  assert.equal(fs.existsSync(path.join(remote,'root.txt')),false);assert.equal(fs.readFileSync(path.join(remote,'new.txt'),'utf8'),'new');
});
test('sync deletion keeps ignored descendants and their parent directories in both directions',async t=>{
  const {local,remote,session}=fixture(t,{ignore:['**/keep.txt'],syncOption:{delete:true}});
  for(const [target,action] of [[remote,'sync-up'],[local,'sync-down']]) {
    fs.mkdirSync(path.join(target,'extra'),{recursive:true});fs.writeFileSync(path.join(target,'extra','keep.txt'),'protected');fs.writeFileSync(path.join(target,'extra','remove.txt'),'remove');
    await engine.operate(session,action,'.',{yes:true});
    assert.equal(fs.readFileSync(path.join(target,'extra','keep.txt'),'utf8'),'protected');
    assert.equal(fs.existsSync(path.join(target,'extra','remove.txt')),false);
    // Keep the opposite side empty for the next direction.
    fs.rmSync(path.join(target,'extra'),{recursive:true});
  }
});
test('watch policy follows resolved profiles and watcher.files=false',t=>{
  const {local,raw}=fixture(t);
  const base={...raw,uploadOnSave:false,watcher:{files:'**/*',autoUpload:true,autoDelete:true},profiles:{disabled:{watcher:{files:false,autoUpload:true,autoDelete:true}},save:{uploadOnSave:true,watcher:{files:false}},enabled:{uploadOnSave:true}}};
  const disabled=engine.createSession(local,base,'disabled');t.after(()=>disabled.service.dispose());
  assert.throws(()=>engine.watchPolicy(disabled.config,true),/Enable/);
  const save=engine.createSession(local,base,'save');t.after(()=>save.service.dispose());
  assert.deepEqual(engine.watchPolicy(save.config),{files:false,autoUpload:false,autoDelete:false,uploadOnSave:true});
  const enabled=engine.createSession(local,base,'enabled');t.after(()=>enabled.service.dispose());
  assert.throws(()=>engine.watchPolicy(enabled.config),/requires --yes/);
  assert.equal(engine.watchPolicy(enabled.config,true).uploadOnSave,true);
});
test('Git mirror snapshots remote content before upload and bidirectional sync copies both sides',async t=>{
  const {dir,local,remote,raw}=fixture(t);
  const mirror=path.join(dir,'mirror');
  const session=engine.createSession(local,{...raw,mirror:{enabled:true,path:mirror}});t.after(()=>session.service.dispose());
  fs.writeFileSync(path.join(local,'a.txt'),'local replacement');fs.writeFileSync(path.join(remote,'a.txt'),'remote before upload');
  await engine.operate(session,'upload','a.txt');
  assert.equal(fs.readFileSync(path.join(mirror,'a.txt'),'utf8'),'remote before upload');
  assert.ok(fs.existsSync(path.join(mirror,'.git','HEAD')));
  fs.writeFileSync(path.join(local,'only-local.txt'),'local');fs.writeFileSync(path.join(remote,'only-remote.txt'),'remote');
  await engine.operate(session,'sync-both');
  assert.equal(fs.readFileSync(path.join(remote,'only-local.txt'),'utf8'),'local');
  assert.equal(fs.readFileSync(path.join(local,'only-remote.txt'),'utf8'),'remote');
});
test('terminal uses the same engine and reports errors with nonzero exit',async t=>{
  const {local,remote,raw}=fixture(t);fs.mkdirSync(path.join(local,'.vscode'));fs.writeFileSync(path.join(local,'.vscode','sftp.json'),JSON.stringify(raw));fs.writeFileSync(path.join(local,'cli.txt'),'from CLI');
  const run=(...args)=>spawnSync(process.execPath,[path.resolve('cli.js'),'sftp',...args],{encoding:'utf8',timeout:20000});
  const uploaded=run('upload',local,'cli.txt');assert.equal(uploaded.status,0,uploaded.stderr);assert.equal(JSON.parse(uploaded.stdout).passed,true);assert.equal(fs.readFileSync(path.join(remote,'cli.txt'),'utf8'),'from CLI');
  assert.equal(run('upload',local,'missing').status,1);
  const profiles=run('profiles',local);assert.equal(profiles.status,0,profiles.stderr);assert.equal(profiles.stdout.includes('password'),false);
});
test('shared configuration persistence creates safe defaults without overwriting existing settings',async t=>{
  const {local}=fixture(t);
  const adapter=require('../src/data/sftp-config');const file=path.join(local,'.vscode','sftp.json');
  await adapter.ensureConfiguration(file,engine.initialConfig());
  const initial=await adapter.readConfiguration(file);assert.ok(initial.ignore.includes('.vscode'));assert.ok(initial.ignore.includes('.env.*'));
  fs.writeFileSync(file,JSON.stringify({...initial,host:'${env:SERVER}'}));
  await adapter.ensureConfiguration(file,engine.initialConfig());
  const resolved=engine.normalizeConfigurations(await adapter.readConfiguration(file),{SERVER:'example.test'});
  assert.equal(resolved[0].host,'example.test');
  assert.throws(()=>engine.normalizeConfigurations({host:'${env:MISSING}'},{}),/Missing environment/);
});
test('sidebar contributes a toolkit entry and all upstream public SFTP commands',()=>{
  const manifest=require('../package.json'),upstream=require('../vendor/sftp/package.json');
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].id,'devkit');
  assert.ok(manifest.contributes.views.devkit.some(v=>v.id==='devkit.tools'));
  for(const command of upstream.contributes.commands) assert.ok(manifest.contributes.commands.some(c=>c.command==='devkit.'+command.command),command.command);
  const metadata=JSON.parse(fs.readFileSync('dist/sftp-engine-metafile.json','utf8'));
  assert.equal(Object.keys(metadata.inputs).some(p=>p.startsWith('src/interface/')),false);
  assert.equal(Object.values(metadata.outputs).some(o=>o.imports.some(i=>i.path==='vscode')),false);
});

test('cancellation during planning prevents payload writes and reports failure',async t=>{
  for (const phase of ['ensureDir','list']) {
    const {local,remote,session}=fixture(t);
    fs.writeFileSync(path.join(local,'cancel.txt'),'must not upload');
    const source=session.service.getLocalFileSystem(),target=await session.service.getRemoteFileSystem(session.config);
    const adapter=phase==='list'?source:target,original=adapter[phase];
    adapter[phase]=async function(...args){const result=await original.apply(this,args);session.service.cancelTransferTasks();return result;};
    try {await assert.rejects(engine.operate(session,'upload'),/cancelled/);assert.equal(fs.existsSync(path.join(remote,'cancel.txt')),false);assert.equal(session.service.isTransferring(),false);}
    finally {adapter[phase]=original;}
  }
});

test('cancellation during symlink reads and file close preserves existing destinations',async t=>{
  let task, writes=0;
  const source={readlink:async()=>{task.cancel();return 'new';}};
  const target={symlink:async()=>writes++,unlink:async()=>{},rename:async()=>writes++};
  task=new engine.TransferTask({fsPath:'/source',fileSystem:source},{fsPath:'/target',fileSystem:target},{fileType:engine.FileType.SymbolicLink,transferDirection:engine.TransferDirection.LOCAL_TO_REMOTE,transferOption:{}});
  await assert.rejects(task.run(),/cancelled/);assert.equal(writes,0);
  const {local,remote,session}=fixture(t);
  fs.writeFileSync(path.join(local,'a.txt'),'new');fs.writeFileSync(path.join(remote,'a.txt'),'original');
  const adapter=await session.service.getRemoteFileSystem(session.config),close=adapter.close;
  adapter.close=async function(...args){await close.apply(this,args);session.service.cancelTransferTasks();};
  try {await assert.rejects(engine.operate(session,'upload','a.txt'),/cancelled/);assert.equal(fs.readFileSync(path.join(remote,'a.txt'),'utf8'),'original');assert.deepEqual(fs.readdirSync(remote),['a.txt']);}
  finally {adapter.close=close;}
});
test('cancellation while waiting for replacement lock preserves the completed first transfer',async()=>{
  let release,entered;const blocked=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
  const entries=new Map([['/target','original']]);let first=true;
  const target={symlink:async(value,name)=>entries.set(name,value),lstat:async name=>{if(!entries.has(name))throw Object.assign(new Error('missing'),{code:2});return {type:engine.FileType.SymbolicLink};},rename:async(a,b)=>{if(first){first=false;entered();await hold;}entries.set(b,entries.get(a));entries.delete(a);},unlink:async name=>entries.delete(name)};
  const make=value=>new engine.TransferTask({fsPath:'/source',fileSystem:{readlink:async()=>value}},{fsPath:'/target',fileSystem:target},{fileType:engine.FileType.SymbolicLink,transferDirection:engine.TransferDirection.LOCAL_TO_REMOTE,transferOption:{}});
  const one=make('first'),two=make('second');const running=one.run();await blocked;
  const waiting=two.run();await new Promise(resolve=>setImmediate(resolve));two.cancel();release();
  await running;await assert.rejects(waiting,/cancelled/);assert.equal(entries.get('/target'),'first');assert.equal(entries.size,1);
});

test('SSH descriptor limiter releases failed opens and reserves concurrent slots',async()=>{
  const client=new engine.SFTPFileSystem(path.posix,{client:{}})._createClient({});
  let callbacks=0;
  const failing=client._hookCallForRequestFileDescriptor((name,cb)=>cb(new Error('denied')));
  for(let n=0;n<350;n++)failing('missing',error=>{assert.match(error.message,/denied/);callbacks++;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(callbacks,350);assert.equal(client._opendFdNum,0);
  const pending=[];let completed=0;
  const concurrent=client._hookCallForRequestFileDescriptor((name,cb)=>pending.push(cb));
  for(let n=0;n<300;n++)concurrent('file',()=>completed++);
  assert.equal(pending.length,222);assert.equal(client._opendFdNum,222);
  pending.splice(0).forEach(cb=>cb(new Error('denied')));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,78);
  pending.splice(0).forEach(cb=>cb(new Error('missing')));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,300);assert.equal(client._opendFdNum,0);
  client._hookCallForRequestFileDescriptor((name,cb)=>cb(null,Buffer.from('handle')))('ok',()=>{});
  assert.equal(client._opendFdNum,1);
  client._hookCallForReleaseFileDescriptor((handle,cb)=>cb(null))(Buffer.from('handle'),()=>{});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(client._opendFdNum,0);
});

test('new private directories establish permissions before payloads in both directions',async t=>{
  for(const action of ['upload','download','sync-up','sync-down']) {
    const {local,remote,session}=fixture(t);
    const down=action==='download'||action==='sync-down';
    const sourceDir=down?remote:local,destination=down?local:remote;
    fs.mkdirSync(path.join(sourceDir,'private'));fs.writeFileSync(path.join(sourceDir,'private','data.txt'),'private by parent');
    const source=down?await session.service.getRemoteFileSystem(session.config):session.service.getLocalFileSystem();
    const target=down?session.service.getLocalFileSystem():await session.service.getRemoteFileSystem(session.config);
    const sourceStat=source.lstat,targetStat=target.lstat,chmod=target.chmod,put=target.put,establish=target.establishDirectoryMode;const modes=new Map();let payloads=0;
    source.lstat=async name=>{const stat=await sourceStat.call(source,name);return {...stat,mode:stat.type===engine.FileType.Directory?0o700:0o644};};
    target.lstat=async name=>({...await targetStat.call(target,name),...(modes.has(name)?{mode:modes.get(name)}:{})});
    target.establishDirectoryMode=async(name,mode)=>{modes.set(name,mode);};
    target.put=async function(...args){assert.equal(modes.get(path.join(destination,'private')),0o700);payloads++;return put.apply(this,args);};
    try {await engine.operate(session,action);assert.equal(payloads,1);assert.equal(fs.readFileSync(path.join(destination,'private','data.txt'),'utf8'),'private by parent');}
    finally {source.lstat=sourceStat;target.lstat=targetStat;target.chmod=chmod;target.put=put;target.establishDirectoryMode=establish;}
  }
});
test('ignoreExisting recurses into matching directories to copy new files',async t=>{
  for(const action of ['sync-up','sync-down']) {
    const {local,remote,session}=fixture(t,{syncOption:{ignoreExisting:true}});
    for(const root of [local,remote]){fs.mkdirSync(path.join(root,'nested'));fs.writeFileSync(path.join(root,'nested','existing.txt'),root);}
    const source=action==='sync-up'?local:remote,target=action==='sync-up'?remote:local;
    fs.writeFileSync(path.join(source,'nested','new.txt'),'new child');
    await engine.operate(session,action);
    assert.equal(fs.readFileSync(path.join(target,'nested','new.txt'),'utf8'),'new child');
    assert.equal(fs.readFileSync(path.join(target,'nested','existing.txt'),'utf8'),target);
  }
});

test('unverified private directory permissions stop before transferring payloads',async t=>{
  const {local,remote,session}=fixture(t);fs.mkdirSync(path.join(local,'private'));fs.writeFileSync(path.join(local,'private','data.txt'),'secret');
  const source=session.service.getLocalFileSystem(),target=await session.service.getRemoteFileSystem(session.config);
  const stat=source.lstat,chmod=target.chmod,put=target.put,establish=target.establishDirectoryMode;let writes=0;
  source.lstat=async name=>({...await stat.call(source,name),mode:0o700});target.establishDirectoryMode=async()=>{throw new Error('Cannot establish required directory permissions');};target.put=async()=>{writes++;};
  try {await assert.rejects(engine.operate(session,'upload'),/required directory permissions/);assert.equal(writes,0);assert.equal(fs.existsSync(path.join(remote,'private')),false);}
  finally {source.lstat=stat;target.chmod=chmod;target.put=put;target.establishDirectoryMode=establish;}
});

test('Windows downloads accept Unix directory modes with protected native ACLs',{skip:process.platform!=='win32'},async t=>{
  for(const mode of [0o755,0o700]) {
    const {local,remote,session}=fixture(t);fs.mkdirSync(path.join(remote,'unix'));fs.writeFileSync(path.join(remote,'unix','file.txt'),'from Unix');
    const source=await session.service.getRemoteFileSystem(session.config),stat=source.lstat;
    source.lstat=async name=>{const value=await stat.call(source,name);return {...value,mode:value.type===engine.FileType.Directory?mode:value.mode};};
    try {await engine.operate(session,'download');assert.equal(fs.readFileSync(path.join(local,'unix','file.txt'),'utf8'),'from Unix');}
    finally {source.lstat=stat;}
    // Independent read of the native ACL, not a mocked chmod/stat conversion.
    const script="$a=[System.IO.Directory]::GetAccessControl($env:DEVKIT_TEST_DIRECTORY); if(-not $a.AreAccessRulesProtected){exit 1}; $s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach($r in $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($r.IdentityReference.Value -notin @($s,'S-1-5-18')){exit 2}}";
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,DEVKIT_TEST_DIRECTORY:path.join(local,'unix')},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
});

test('Windows staging protects new files and preserves destination ACL before payloads',{skip:process.platform!=='win32'},async t=>{
  const {local,remote,session}=fixture(t);fs.writeFileSync(path.join(remote,'private.txt'),'first payload');
  const acl=name=>{
    const script="$a=[System.IO.File]::GetAccessControl($env:DEVKIT_TEST_FILE); if(-not $a.AreAccessRulesProtected){exit 1}; $s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach($r in $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($r.IdentityReference.Value -notin @($s,'S-1-5-18')){exit 2}}; $a.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)";
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,DEVKIT_TEST_FILE:name},encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();
  };
  const adapter=session.service.getLocalFileSystem(),put=adapter.put;let expected;
  adapter.put=async function(stream,staged,options){const actual=acl(staged);if(expected)assert.equal(actual,expected);return put.call(this,stream,staged,options);};
  try {
    await engine.operate(session,'download','private.txt');expected=acl(path.join(local,'private.txt'));
    fs.writeFileSync(path.join(remote,'private.txt'),'replacement');await engine.operate(session,'download','private.txt');
    assert.equal(acl(path.join(local,'private.txt')),expected);assert.equal(fs.readFileSync(path.join(local,'private.txt'),'utf8'),'replacement');
  } finally {adapter.put=put;}
});
test('explicit upload directory permissions apply to every missing parent',async t=>{
  const {local,remote,session}=fixture(t,{dirPerm:750});fs.mkdirSync(path.join(local,'one','two'),{recursive:true});fs.writeFileSync(path.join(local,'one','two','file.txt'),'nested');
  const target=await session.service.getRemoteFileSystem(session.config),establish=target.establishDirectoryMode,chmod=target.chmod;const observed=new Map();
  target.establishDirectoryMode=async(name,mode)=>observed.set(path.resolve(name),mode);target.chmod=async()=>{};
  try {await engine.operate(session,'upload','one/two/file.txt');assert.equal(observed.get(path.join(remote,'one')),0o750);assert.equal(observed.get(path.join(remote,'one','two')),0o750);}
  finally {target.establishDirectoryMode=establish;target.chmod=chmod;}
});

test('Git mirror object database is private, including an existing repository',async t=>{
  const {dir,local,remote,raw}=fixture(t);const mirror=path.join(dir,'private-mirror');
  fs.mkdirSync(mirror);fs.writeFileSync(path.join(mirror,'preexisting.txt'),'existing private data');
  const session=engine.createSession(local,{...raw,mirror:{enabled:true,path:mirror}});t.after(()=>session.service.dispose());
  fs.writeFileSync(path.join(local,'a.txt'),'local');fs.writeFileSync(path.join(remote,'a.txt'),'remote secret');
  await engine.operate(session,'upload','a.txt');
  fs.writeFileSync(path.join(local,'a.txt'),'second');await engine.operate(session,'upload','a.txt');
  assert.ok(fs.existsSync(path.join(mirror,'.git','objects')));
  if(process.platform==='win32') {
    const script="$s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach($p in [System.IO.Directory]::GetFiles($env:DEVKIT_TEST_DIRECTORY,'*',[System.IO.SearchOption]::AllDirectories)){foreach($r in [System.IO.File]::GetAccessControl($p).GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($r.IdentityReference.Value -notin @($s,'S-1-5-18')){exit 2}}}";
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,DEVKIT_TEST_DIRECTORY:mirror},encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  } else assert.equal(fs.statSync(mirror).mode & 0o777,0o700);
});
test('Unix staging restores destination permissions masked by umask',{skip:process.platform==='win32'},async t=>{
  const {local,remote,session}=fixture(t);fs.writeFileSync(path.join(local,'a.txt'),'old');fs.chmodSync(path.join(local,'a.txt'),0o664);fs.writeFileSync(path.join(remote,'a.txt'),'new');
  const mask=process.umask(0o022);
  try {await engine.operate(session,'download','a.txt');assert.equal(fs.statSync(path.join(local,'a.txt')).mode & 0o777,0o664);}
  finally {process.umask(mask);}
});

test('Create File does not truncate a concurrent creator',async t=>{
  const {remote,session}=fixture(t);const target=await session.service.getRemoteFileSystem(session.config),stat=target.lstat;
  const file=path.join(remote,'race.txt');let injected=false;
  target.lstat=async function(name){if(path.resolve(name)===file&&!injected){injected=true;fs.writeFileSync(file,'other client');throw Object.assign(new Error('initially absent'),{code:'ENOENT'});}return stat.call(this,name);};
  try {await assert.rejects(engine.operate(session,'create','race.txt'),/EEXIST|exists/);assert.equal(fs.readFileSync(file,'utf8'),'other client');}
  finally {target.lstat=stat;}
  assert.equal(new engine.FTPFileSystem(path.posix,{client:{}}).supportsExclusiveCreate,false);
});

test('unparseable FTP listings cannot cause sync to delete local files',async t=>{
  for(const invalid of ['unparsed server line',{},null]) {
    const {local,session}=fixture(t);fs.writeFileSync(path.join(local,'keep.txt'),'must survive');
    const ftp=new engine.FTPFileSystem(path.posix,{client:{getFsClient:()=>({list:(_,cb)=>cb(null,[invalid])})}});
    session.service.getRemoteFileSystem=async()=>ftp;
    await assert.rejects(engine.operate(session,'sync-down','.',{yes:true}),/unparseable/);
    assert.equal(fs.readFileSync(path.join(local,'keep.txt'),'utf8'),'must survive');
  }
});
test('SSH final jump destination receives default port without mutating configuration',async()=>{
  const client=new engine.SFTPFileSystem(path.posix,{client:{}})._createClient({});
  const proto=Object.getPrototypeOf(client),connect=proto.connect;const forwarded=[];
  proto.connect=async()=>{};
  client._makeHopping=async(previous,host,port)=>{forwarded.push({host,port});return {};};
  client._connectSSHClient=async()=>{};client._getSftp=async()=>({});
  const hop=[{host:'middle'},{host:'final'}];
  try {await client._doConnect({host:'first',hop},{});assert.deepEqual(forwarded,[{host:'middle',port:22},{host:'final',port:22}]);assert.equal(hop[1].port,undefined);}
  finally {proto.connect=connect;client.end();}
});

test('incomplete FTP listing semantics cannot delete omitted local dotfiles',async t=>{
  const {local,session}=fixture(t,{syncOption:{delete:true}});fs.writeFileSync(path.join(local,'.htaccess'),'keep');
  const ftp=new engine.FTPFileSystem(path.posix,{client:{getFsClient:()=>({list:(_,cb)=>cb(null,[])})}});
  session.service.getRemoteFileSystem=async()=>ftp;
  await assert.rejects(engine.operate(session,'sync-down','.',{yes:true}),/complete source directory listing/);
  assert.equal(fs.readFileSync(path.join(local,'.htaccess'),'utf8'),'keep');
});

test('recursive terminal deletion preserves ignored remote-only descendants',async t=>{
  const {remote,session}=fixture(t,{ignore:['**/.env']});fs.mkdirSync(path.join(remote,'config'));fs.writeFileSync(path.join(remote,'config','.env'),'server only');fs.writeFileSync(path.join(remote,'config','remove.txt'),'obsolete');
  await engine.operate(session,'delete','config',{yes:true});
  assert.equal(fs.readFileSync(path.join(remote,'config','.env'),'utf8'),'server only');assert.equal(fs.existsSync(path.join(remote,'config','remove.txt')),false);
});
