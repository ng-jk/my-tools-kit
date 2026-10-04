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
  assert.deepEqual(args,['-t','-p','22','-o','ServerAliveInterval=30','--','deploy@example.test','cd /project; exec bash']);
});
test('malicious directory entries cannot schedule writes outside the destination',async()=>{
  for (const name of ['../../outside.txt','../escape','nested/file','nested\\file','C:stream','.. ']) {
    const source={pathResolver:path.posix,lstat:async()=>({type:engine.FileType.Directory}),list:async()=>[{name,fspath:'/server/'+name,type:engine.FileType.File}]};
    const target={pathResolver:path.posix,ensureDir:async()=>{}};
    const tasks=[];
    await assert.rejects(engine.transfer({srcFsPath:'/server',targetFsPath:'/workspace/project',srcFs:source,targetFs:target,transferDirection:engine.TransferDirection.REMOTE_TO_LOCAL,transferOption:{}},task=>tasks.push(task)),/Unsafe|escapes/);
    assert.equal(tasks.length,0);
  }
});
test('sync preserves symbolic link identity without reading linked file contents',async()=>{
  const source={pathResolver:path.posix,list:async()=>[{name:'link',fspath:'/local/link',type:engine.FileType.SymbolicLink,mtime:1,atime:1}],readlink:async()=>'../../private/key',get:async()=>{throw new Error('must not dereference');}};
  let link;
  const target={pathResolver:path.posix,ensureDir:async()=>{},list:async()=>[],lstat:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});},unlink:async()=>{},rename:async(_,destination)=>{link.destination=destination;},symlink:async(value,destination)=>{link={value,destination};}};
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
test('sidebar contributes a toolkit entry and all upstream public SFTP commands',()=>{
  const manifest=require('../package.json'),upstream=require('../vendor/sftp/package.json');
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].id,'devkit');
  assert.ok(manifest.contributes.views.devkit.some(v=>v.id==='devkit.tools'));
  for(const command of upstream.contributes.commands) assert.ok(manifest.contributes.commands.some(c=>c.command==='devkit.'+command.command),command.command);
  const metadata=JSON.parse(fs.readFileSync('dist/sftp-engine-metafile.json','utf8'));
  assert.equal(Object.keys(metadata.inputs).some(p=>p.startsWith('src/interface/')),false);
  assert.equal(Object.values(metadata.outputs).some(o=>o.imports.some(i=>i.path==='vscode')),false);
});
