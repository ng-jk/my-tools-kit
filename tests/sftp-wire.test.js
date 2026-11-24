'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {Server,utils}=require('ssh2');
const engine=require(process.env.DEVKIT_BENCHMARK_ENGINE||'../build/sftp/engine');
function readSudoChallenge(sftp,channel,confirm=true){
 const push=sftp.push.bind(sftp);let waiting=true,pending=Buffer.alloc(0);
 sftp.push=data=>{
  if(!waiting||data===null)return push(data);
  pending=Buffer.concat([pending,data]);const newline=pending.indexOf(10);if(newline<0)return;
  const token=pending.subarray(0,newline).toString();assert.match(token,/^DEVKIT_SUDO_[a-f0-9]{48}$/);waiting=false;
  if(confirm)channel.stderr.write('fixture warning\n'+token+'\n');const rest=pending.subarray(newline+1);pending=Buffer.alloc(0);if(rest.length)return push(rest);
 };
}

test('SFTP wire: password authentication, list, upload, temp rename, download and delete', {timeout:process.env.DEVKIT_SFTP_BENCHMARK_OUTPUT?180000:30000}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-ssh-'));
  const local=path.join(root,'local'),remote=path.join(root,'remote');fs.mkdirSync(local);fs.mkdirSync(remote);
  const hostKey=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
  let replaceOnClose=false,replacedFolder=false,renamesAfterRace=0;let authentications=0,honorOpen=true,allowChmod=true;const modes=new Map([['/',0o755]]),writeModes=[];let pathChmods=0;
  const requestCounts={};
  const clients=new Set();const {STATUS_CODE,OPEN_MODE}=utils.sftp;
  const server=new Server({hostKeys:[hostKey]},client=>{
    clients.add(client);client.on('close',()=>clients.delete(client));client.on('error',()=>{});
    client.on('authentication',ctx=>{authentications++;return ctx.method==='password' && ctx.username==='fixture' && ctx.password==='test-password'?ctx.accept():ctx.reject();});
    client.on('ready',()=>client.on('session',accept=>accept().on('sftp',accept=>{
      const sftp=accept(),handles=new Map();let id=0;
      const on=sftp.on.bind(sftp);sftp.on=(name,handler)=>on(name,(...args)=>{requestCounts[name]=(requestCounts[name]||0)+1;handler(...args);});
      const resolve=p=>{const target=path.resolve(remote,'.'+p);if(!target.startsWith(remote+path.sep)&&target!==remote)throw new Error('outside fixture');return target;};
      const attrs=(s,p)=>({mode:p==='/race'&&replacedFolder?0o120755:(s.mode & ~0o777)|(modes.get(p)??(s.mode & 0o777)),size:s.size,uid:0,gid:0,atime:Math.floor(s.atimeMs/1000),mtime:Math.floor(s.mtimeMs/1000)});
      const guard=fn=>(request,...args)=>{const run=()=>{try{fn(request,...args);}catch(e){sftp.status(request,e.code==='ENOENT'?STATUS_CODE.NO_SUCH_FILE:STATUS_CODE.FAILURE,e.message);}};if(process.env.DEVKIT_SFTP_BENCHMARK_OUTPUT)setTimeout(run,3);else run();};
      const handle=value=>{const h=Buffer.alloc(4);h.writeUInt32BE(++id);handles.set(h.toString('hex'),value);return h;};
      for(const name of ['STAT','LSTAT'])sftp.on(name,guard((req,p)=>sftp.attrs(req,attrs(fs.statSync(resolve(p)),p))));
      sftp.on('REALPATH',guard((req,p)=>sftp.name(req,[{filename:p,longname:p,attrs:{}}])));
      sftp.on('OPENDIR',guard((req,p)=>sftp.handle(req,handle({dir:resolve(p),remotePath:p}))));
      sftp.on('READDIR',guard((req,h)=>{const v=handles.get(h.toString('hex'));if(v.read)return sftp.status(req,STATUS_CODE.EOF);v.read=true;sftp.name(req,fs.readdirSync(v.dir).map(name=>({filename:name,longname:name,attrs:attrs(fs.statSync(path.join(v.dir,name)),path.posix.join(v.remotePath,name))})));}));
      sftp.on('OPEN',guard((req,p,flags,a)=>{const f=flags & OPEN_MODE.WRITE?'w':'r';if(f==='w')modes.set(p,honorOpen?(a.mode??0o644)&0o777:0o644);sftp.handle(req,handle({fd:fs.openSync(resolve(p),f),path:p}));}));
      sftp.on('FSTAT',guard((req,h)=>{const value=handles.get(h.toString('hex'));sftp.attrs(req,attrs(fs.fstatSync(value.fd),value.path));}));
      sftp.on('READ',guard((req,h,offset,len)=>{const data=Buffer.alloc(len),n=fs.readSync(handles.get(h.toString('hex')).fd,data,0,len,offset);if(n)sftp.data(req,data.subarray(0,n));else sftp.status(req,STATUS_CODE.EOF);}));
      sftp.on('WRITE',guard((req,h,offset,data)=>{writeModes.push(modes.get(handles.get(h.toString('hex')).path));fs.writeSync(handles.get(h.toString('hex')).fd,data,0,data.length,offset);sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('CLOSE',guard((req,h)=>{const v=handles.get(h.toString('hex'));if(v.fd!==undefined){fs.closeSync(v.fd);if(replaceOnClose&&v.path.startsWith('/race/')){replaceOnClose=false;replacedFolder=true;}}handles.delete(h.toString('hex'));sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('FSETSTAT',guard((req,h,a)=>{if(a.mode!==undefined){if(!allowChmod)return sftp.status(req,STATUS_CODE.PERMISSION_DENIED);modes.set(handles.get(h.toString('hex')).path,a.mode&0o777);}if(a.atime!==undefined)fs.futimesSync(handles.get(h.toString('hex')).fd,a.atime,a.mtime);sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('SETSTAT',guard((req,p,a)=>{if(a.mode!==undefined){pathChmods++;if(!allowChmod)return sftp.status(req,STATUS_CODE.PERMISSION_DENIED);modes.set(p,a.mode&0o777);}if(a.atime!==undefined)fs.utimesSync(resolve(p),a.atime,a.mtime);sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('MKDIR',guard((req,p,a)=>{modes.set(p,a.mode??0o755);fs.mkdirSync(resolve(p));sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('REMOVE',guard((req,p)=>{fs.unlinkSync(resolve(p));sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('RMDIR',guard((req,p)=>{fs.rmdirSync(resolve(p));sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('RENAME',guard((req,a,b)=>{if(replacedFolder)renamesAfterRace++;fs.renameSync(resolve(a),resolve(b));modes.set(b,modes.get(a));modes.delete(a);sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('EXTENDED',(req)=>sftp.status(req,STATUS_CODE.OP_UNSUPPORTED));
      sftp.on('close',()=>{for(const value of handles.values())if(value.fd!==undefined)try{fs.closeSync(value.fd);}catch{};});
    })));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const session=engine.createSession(local,{host:'127.0.0.1',port:server.address().port,username:'fixture',password:'test-password',remotePath:'/',useTempFile:true,hostFingerprint:engine.fingerprint(utils.parseKey(hostKey).getPublicSSH())});
  t.after(async()=>{session.service.dispose();for(const client of clients)client.end();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  const bad=engine.createSession(local,{host:'127.0.0.1',port:server.address().port,username:'fixture',password:'test-password',remotePath:'/',hostFingerprint:'SHA256:wrong',connectTimeout:1000});
  try {await assert.rejects(engine.operate(bad,'list'),/verification|host key/i);assert.equal(authentications,0);} finally {bad.service.dispose();}
  fs.writeFileSync(path.join(local,'wire.txt'),'over SSH');
  await engine.operate(session,'upload','wire.txt');assert.equal(fs.readFileSync(path.join(remote,'wire.txt'),'utf8'),'over SSH');assert.equal(modes.get('/wire.txt'),0o755);
  if(process.env.DEVKIT_SFTP_BENCHMARK_OUTPUT){
    const count=Number(process.env.DEVKIT_BENCHMARK_FILES||6);assert.ok(Number.isInteger(count)&&count>=1&&count<=48,'Benchmark file count must be 1–48');
    const directory=path.join(local,'perf','a','b');fs.mkdirSync(directory,{recursive:true});for(let n=0;n<count;n++)fs.writeFileSync(path.join(directory,'file'+n+'.txt'),'benchmark '+n);
    const metrics=[];for(const phase of ['new','existing']){const before={...requestCounts},start=performance.now();await engine.operate(session,'upload','perf');const byCommand=Object.fromEntries(Object.entries(requestCounts).map(([key,value])=>[key,value-(before[key]||0)]).filter(([,value])=>value));metrics.push({phase,files:count,elapsedMs:Math.round(performance.now()-start),commands:Object.values(byCommand).reduce((a,b)=>a+b,0),byCommand});for(let n=0;n<count;n++)assert.equal(fs.readFileSync(path.join(remote,'perf','a','b','file'+n+'.txt'),'utf8'),'benchmark '+n);}
    fs.writeFileSync(process.env.DEVKIT_SFTP_BENCHMARK_OUTPUT,JSON.stringify({latencyPerReplyMs:3,depth:3,metrics},null,2));return;
  }
  const peer=engine.createSession(local,{host:'127.0.0.1',port:server.address().port,username:'fixture',password:'test-password',remotePath:'/',useTempFile:true,hostFingerprint:engine.fingerprint(utils.parseKey(hostKey).getPublicSSH())});
  const originalFs=await session.service.getRemoteFileSystem(session.config);
  const peerFs=await peer.service.getRemoteFileSystem(peer.config);
  assert.equal(peerFs,originalFs,'services share the same cached connection');
  peer.service.dispose();
  assert.equal((await originalFs.list('/')).some(entry=>entry.name==='wire.txt'),true,'disposing one owner does not disconnect another');
  const batchAuth=authentications;fs.mkdirSync(path.join(local,'many'));for(let n=0;n<32;n++)fs.writeFileSync(path.join(local,'many','file'+n),'SSH batch '+n);
  await engine.operate(session,'upload','many');assert.equal(authentications,batchAuth,'many files reuse the authenticated SSH connection');for(let n=0;n<32;n++)assert.equal(fs.readFileSync(path.join(remote,'many','file'+n),'utf8'),'SSH batch '+n);
  fs.rmSync(path.join(local,'many'),{recursive:true});fs.rmSync(path.join(remote,'many'),{recursive:true});
  modes.set('/wire.txt',0o600);
  await engine.operate(session,'upload','wire.txt');assert.equal(modes.get('/wire.txt'),0o600);assert.equal(writeModes.at(-1),0o600);
  modes.set('/wire.txt',0o440);
  await engine.operate(session,'upload','wire.txt');assert.equal(modes.get('/wire.txt'),0o640);assert.equal(writeModes.at(-1),0o640);
  await engine.operate(session,'upload','wire.txt');assert.equal(modes.get('/wire.txt'),0o640,'repeated upload retains owner write and group-only read');
  honorOpen=false;allowChmod=false;const written=writeModes.length;
  await engine.operate(session,'upload','wire.txt');
  assert.ok(writeModes.length>written,'server-masked modes do not block uploads');assert.equal(fs.readFileSync(path.join(remote,'wire.txt'),'utf8'),'over SSH');
  honorOpen=true;allowChmod=true;
  await engine.operate(session,'mkdir','created-directory');assert.equal(modes.get('/created-directory'),0o755);
  await engine.operate(session,'create','created-default.txt');assert.equal(modes.get('/created-default.txt'),0o755);
  honorOpen=false;await engine.operate(session,'create','created-masked.txt');assert.equal(modes.get('/created-masked.txt'),0o755,'creation restores 755 after server masks OPEN mode');
  const beforePathChmod=pathChmods;allowChmod=false;await assert.rejects(engine.operate(session,'create','created-unverified.txt'),error=>error.code==='CREATE_FILE_INCOMPLETE'&&/entry may remain/.test(error.message));
  assert.equal(pathChmods,beforePathChmod,'failed descriptor chmod never falls back to SETSTAT');
  assert.equal(fs.existsSync(path.join(remote,'created-unverified.txt')),true);
  allowChmod=true;await assert.rejects(engine.operate(session,'create','created-unverified.txt'),/already exists/);
  await engine.operate(session,'delete','created-unverified.txt',{yes:true});await engine.operate(session,'create','created-unverified.txt');assert.equal(modes.get('/created-unverified.txt'),0o755,'inspect/remove and retry restores exclusive creation after fixing server permissions');
  honorOpen=true;allowChmod=true;

  fs.mkdirSync(path.join(remote,'var','www','cms'),{recursive:true});fs.mkdirSync(path.join(local,'var','www','cms'),{recursive:true});modes.set('/var',0o755);modes.set('/var/www',0o775);modes.set('/var/www/cms',0o777);
  fs.writeFileSync(path.join(local,'var','www','cms','shared.php'),'shared SFTP upload');session.config.dirPerm=755;await engine.operate(session,'upload','var/www/cms/shared.php');delete session.config.dirPerm;
  assert.equal(fs.readFileSync(path.join(remote,'var','www','cms','shared.php'),'utf8'),'shared SFTP upload');assert.equal(modes.get('/var/www'),0o775);assert.equal(modes.get('/var/www/cms'),0o777);
  fs.mkdirSync(path.join(remote,'race'));modes.set('/race',0o755);fs.mkdirSync(path.join(local,'race'));fs.writeFileSync(path.join(local,'race','victim.txt'),'new payload');fs.writeFileSync(path.join(remote,'race','victim.txt'),'original');replaceOnClose=true;
  await assert.rejects(engine.operate(session,'upload','race/victim.txt'),/not a real directory/);assert.equal(renamesAfterRace,0);assert.equal(fs.readFileSync(path.join(remote,'race','victim.txt'),'utf8'),'original');replacedFolder=false;fs.rmSync(path.join(local,'race'),{recursive:true,force:true});fs.rmSync(path.join(remote,'race'),{recursive:true,force:true});modes.delete('/race');
  assert.equal((await engine.operate(session,'list')).some(item=>item.name==='wire.txt'),true);
  fs.writeFileSync(path.join(remote,'wire.txt'),'server change');await engine.operate(session,'download','wire.txt');assert.equal(fs.readFileSync(path.join(local,'wire.txt'),'utf8'),'server change');
  fs.mkdirSync(path.join(remote,'nested'));modes.set('/nested',0o755);fs.writeFileSync(path.join(remote,'nested','remote-only.txt'),'nested from server');
  fs.writeFileSync(path.join(remote,'remote-only.txt'),'from server');
  await engine.operate(session,'sync-both');
  assert.equal(fs.readFileSync(path.join(local,'remote-only.txt'),'utf8'),'from server');
  assert.equal(fs.readFileSync(path.join(local,'nested','remote-only.txt'),'utf8'),'nested from server');
  await engine.operate(session,'delete','wire.txt',{yes:true});assert.equal(fs.existsSync(path.join(remote,'wire.txt')),false);
});

test('Sudo SFTP wire: authenticated exec supports list, upload, backup, download and delete', {timeout:process.env.DEVKIT_SFTP_BENCHMARK_OUTPUT?180000:90000}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-ssh-'));
  const local=path.join(root,'local'),remote=path.join(root,'remote');fs.mkdirSync(local);fs.mkdirSync(remote);
  const hostKey=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
  let replaceOnClose=false,replacedFolder=false,renamesAfterRace=0;let authentications=0,honorOpen=true,allowChmod=true;const modes=new Map([['/',0o755]]),writeModes=[];let pathChmods=0;
  const requestCounts={};let dropNextStat=false,agentForwardRequests=0;
  const clients=new Set(),elevatedChannels=[];const {STATUS_CODE,OPEN_MODE}=utils.sftp;
  const server=new Server({hostKeys:[hostKey]},client=>{
    clients.add(client);client.on('close',()=>clients.delete(client));client.on('error',()=>{});
    client.on('authentication',ctx=>{authentications++;return ctx.method==='password' && ctx.username==='fixture' && ctx.password==='test-password'?ctx.accept():ctx.reject();});
    client.on('ready',()=>client.on('session',accept=>accept().on('auth-agent',accept=>{agentForwardRequests++;accept();}).on('exec',(accept,reject,info)=>{
      assert.match(info.command,/^sudo -n -- \/bin\/sh -c 'IFS= read -r token;/);
      assert.ok(info.command.includes('[ "$(id -u)" = 0 ]'));
      assert.ok(info.command.endsWith("exec /usr/lib/openssh/sftp-server'"));assert.ok(!info.command.includes('DEVKIT_SUDO_'));
      const channel=accept();elevatedChannels.push(channel);
      const {SFTP}=require('ssh2/lib/protocol/SFTP');
      const sftp=new SFTP(client,{type:channel.type,incoming:channel.incoming,outgoing:channel.outgoing},{server:true});
      readSudoChallenge(sftp,channel);
      client._chanMgr.update(channel.incoming.id,sftp);
      const handles=new Map();let id=0;
      const on=sftp.on.bind(sftp);sftp.on=(name,handler)=>on(name,(...args)=>{requestCounts[name]=(requestCounts[name]||0)+1;handler(...args);});
      const resolve=p=>{const target=path.resolve(remote,'.'+p);if(!target.startsWith(remote+path.sep)&&target!==remote)throw new Error('outside fixture');return target;};
      const attrs=(s,p)=>({mode:p==='/race'&&replacedFolder?0o120755:(s.mode & ~0o777)|(modes.get(p)??(s.mode & 0o777)),size:s.size,uid:0,gid:0,atime:Math.floor(s.atimeMs/1000),mtime:Math.floor(s.mtimeMs/1000)});
      const guard=fn=>(request,...args)=>{const run=()=>{try{fn(request,...args);}catch(e){sftp.status(request,e.code==='ENOENT'?STATUS_CODE.NO_SUCH_FILE:STATUS_CODE.FAILURE,e.message);}};if(process.env.DEVKIT_SFTP_BENCHMARK_OUTPUT)setTimeout(run,3);else run();};
      const handle=value=>{const h=Buffer.alloc(4);h.writeUInt32BE(++id);handles.set(h.toString('hex'),value);return h;};
      for(const name of ['STAT','LSTAT'])sftp.on(name,guard((req,p)=>{if(dropNextStat){dropNextStat=false;channel.close();return;}sftp.attrs(req,attrs(fs.statSync(resolve(p)),p));}));
      sftp.on('REALPATH',guard((req,p)=>sftp.name(req,[{filename:p,longname:p,attrs:{}}])));
      sftp.on('OPENDIR',guard((req,p)=>sftp.handle(req,handle({dir:resolve(p),remotePath:p}))));
      sftp.on('READDIR',guard((req,h)=>{const v=handles.get(h.toString('hex'));if(v.read)return sftp.status(req,STATUS_CODE.EOF);v.read=true;sftp.name(req,fs.readdirSync(v.dir).map(name=>({filename:name,longname:name,attrs:attrs(fs.statSync(path.join(v.dir,name)),path.posix.join(v.remotePath,name))})));}));
      sftp.on('OPEN',guard((req,p,flags,a)=>{const f=flags & OPEN_MODE.WRITE?'w':'r';if(f==='w')modes.set(p,honorOpen?(a.mode??0o644)&0o777:0o644);sftp.handle(req,handle({fd:fs.openSync(resolve(p),f),path:p}));}));
      sftp.on('FSTAT',guard((req,h)=>{const value=handles.get(h.toString('hex'));sftp.attrs(req,attrs(fs.fstatSync(value.fd),value.path));}));
      sftp.on('READ',guard((req,h,offset,len)=>{const data=Buffer.alloc(len),n=fs.readSync(handles.get(h.toString('hex')).fd,data,0,len,offset);if(n)sftp.data(req,data.subarray(0,n));else sftp.status(req,STATUS_CODE.EOF);}));
      sftp.on('WRITE',guard((req,h,offset,data)=>{writeModes.push(modes.get(handles.get(h.toString('hex')).path));fs.writeSync(handles.get(h.toString('hex')).fd,data,0,data.length,offset);sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('CLOSE',guard((req,h)=>{const v=handles.get(h.toString('hex'));if(v.fd!==undefined){fs.closeSync(v.fd);if(replaceOnClose&&v.path.startsWith('/race/')){replaceOnClose=false;replacedFolder=true;}}handles.delete(h.toString('hex'));sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('FSETSTAT',guard((req,h,a)=>{if(a.mode!==undefined){if(!allowChmod)return sftp.status(req,STATUS_CODE.PERMISSION_DENIED);modes.set(handles.get(h.toString('hex')).path,a.mode&0o777);}if(a.atime!==undefined)fs.futimesSync(handles.get(h.toString('hex')).fd,a.atime,a.mtime);sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('SETSTAT',guard((req,p,a)=>{if(a.mode!==undefined){pathChmods++;if(!allowChmod)return sftp.status(req,STATUS_CODE.PERMISSION_DENIED);modes.set(p,a.mode&0o777);}if(a.atime!==undefined)fs.utimesSync(resolve(p),a.atime,a.mtime);sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('MKDIR',guard((req,p,a)=>{modes.set(p,a.mode??0o755);fs.mkdirSync(resolve(p));sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('REMOVE',guard((req,p)=>{fs.unlinkSync(resolve(p));sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('RMDIR',guard((req,p)=>{fs.rmdirSync(resolve(p));sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('RENAME',guard((req,a,b)=>{if(replacedFolder)renamesAfterRace++;fs.renameSync(resolve(a),resolve(b));modes.set(b,modes.get(a));modes.delete(a);sftp.status(req,STATUS_CODE.OK);}));
      sftp.on('EXTENDED',(req)=>sftp.status(req,STATUS_CODE.OP_UNSUPPORTED));
      sftp.on('close',()=>{for(const value of handles.values())if(value.fd!==undefined)try{fs.closeSync(value.fd);}catch{};});
    })));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const session=engine.createSession(local,{sudo:true,agent:'/fixture-agent-do-not-contact',agentForward:true,sftpServerPath:'/usr/lib/openssh/sftp-server',host:'127.0.0.1',port:server.address().port,username:'fixture',password:'test-password',remotePath:'/',useTempFile:true,hostFingerprint:engine.fingerprint(utils.parseKey(hostKey).getPublicSSH())});
  t.after(async()=>{session.service.dispose();for(const client of clients)client.end();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  const bad=engine.createSession(local,{sudo:true,agent:'/fixture-agent-do-not-contact',agentForward:true,sftpServerPath:'/usr/lib/openssh/sftp-server',host:'127.0.0.1',port:server.address().port,username:'fixture',password:'test-password',remotePath:'/',hostFingerprint:'SHA256:wrong',connectTimeout:1000});
  try {await assert.rejects(engine.operate(bad,'list'),/verification|host key/i);assert.equal(authentications,0);} finally {bad.service.dispose();}
  fs.writeFileSync(path.join(local,'wire.txt'),'over SSH');
  await engine.operate(session,'upload','wire.txt');assert.equal(fs.readFileSync(path.join(remote,'wire.txt'),'utf8'),'over SSH');assert.equal(modes.get('/wire.txt'),0o755);
  if(process.env.DEVKIT_SFTP_BENCHMARK_OUTPUT){
    const count=Number(process.env.DEVKIT_BENCHMARK_FILES||6);assert.ok(Number.isInteger(count)&&count>=1&&count<=48,'Benchmark file count must be 1–48');
    const directory=path.join(local,'perf','a','b');fs.mkdirSync(directory,{recursive:true});for(let n=0;n<count;n++)fs.writeFileSync(path.join(directory,'file'+n+'.txt'),'benchmark '+n);
    const metrics=[];for(const phase of ['new','existing']){const before={...requestCounts},start=performance.now();await engine.operate(session,'upload','perf');const byCommand=Object.fromEntries(Object.entries(requestCounts).map(([key,value])=>[key,value-(before[key]||0)]).filter(([,value])=>value));metrics.push({phase,files:count,elapsedMs:Math.round(performance.now()-start),commands:Object.values(byCommand).reduce((a,b)=>a+b,0),byCommand});for(let n=0;n<count;n++)assert.equal(fs.readFileSync(path.join(remote,'perf','a','b','file'+n+'.txt'),'utf8'),'benchmark '+n);}
    fs.writeFileSync(process.env.DEVKIT_SFTP_BENCHMARK_OUTPUT,JSON.stringify({latencyPerReplyMs:3,depth:3,metrics},null,2));return;
  }
  const peer=engine.createSession(local,{sudo:true,agent:'/fixture-agent-do-not-contact',agentForward:true,sftpServerPath:'/usr/lib/openssh/sftp-server',host:'127.0.0.1',port:server.address().port,username:'fixture',password:'test-password',remotePath:'/',useTempFile:true,hostFingerprint:engine.fingerprint(utils.parseKey(hostKey).getPublicSSH())});
  const originalFs=await session.service.getRemoteFileSystem(session.config);
  const peerFs=await peer.service.getRemoteFileSystem(peer.config);
  assert.equal(peerFs,originalFs,'services share the same cached connection');
  peer.service.dispose();
  assert.equal((await originalFs.list('/')).some(entry=>entry.name==='wire.txt'),true,'disposing one owner does not disconnect another');
  const batchAuth=authentications;fs.mkdirSync(path.join(local,'many'));for(let n=0;n<32;n++)fs.writeFileSync(path.join(local,'many','file'+n),'SSH batch '+n);
  await engine.operate(session,'upload','many');assert.equal(authentications,batchAuth,'many files reuse the authenticated SSH connection');for(let n=0;n<32;n++)assert.equal(fs.readFileSync(path.join(remote,'many','file'+n),'utf8'),'SSH batch '+n);
  fs.rmSync(path.join(local,'many'),{recursive:true});fs.rmSync(path.join(remote,'many'),{recursive:true});
  modes.set('/wire.txt',0o600);
  await engine.operate(session,'upload','wire.txt');assert.equal(modes.get('/wire.txt'),0o600);assert.equal(writeModes.at(-1),0o600);
  modes.set('/wire.txt',0o440);
  await engine.operate(session,'upload','wire.txt');assert.equal(modes.get('/wire.txt'),0o640);assert.equal(writeModes.at(-1),0o640);
  await engine.operate(session,'upload','wire.txt');assert.equal(modes.get('/wire.txt'),0o640,'repeated upload retains owner write and group-only read');
  honorOpen=false;allowChmod=false;const written=writeModes.length;
  await engine.operate(session,'upload','wire.txt');
  assert.ok(writeModes.length>written,'server-masked modes do not block uploads');assert.equal(fs.readFileSync(path.join(remote,'wire.txt'),'utf8'),'over SSH');
  honorOpen=true;allowChmod=true;
  await engine.operate(session,'mkdir','created-directory');assert.equal(modes.get('/created-directory'),0o755);
  await engine.operate(session,'create','created-default.txt');assert.equal(modes.get('/created-default.txt'),0o755);
  honorOpen=false;await engine.operate(session,'create','created-masked.txt');assert.equal(modes.get('/created-masked.txt'),0o755,'creation restores 755 after server masks OPEN mode');
  const beforePathChmod=pathChmods;allowChmod=false;await assert.rejects(engine.operate(session,'create','created-unverified.txt'),error=>error.code==='CREATE_FILE_INCOMPLETE'&&/entry may remain/.test(error.message));
  assert.equal(pathChmods,beforePathChmod,'failed descriptor chmod never falls back to SETSTAT');
  assert.equal(fs.existsSync(path.join(remote,'created-unverified.txt')),true);
  allowChmod=true;await assert.rejects(engine.operate(session,'create','created-unverified.txt'),/already exists/);
  await engine.operate(session,'delete','created-unverified.txt',{yes:true});await engine.operate(session,'create','created-unverified.txt');assert.equal(modes.get('/created-unverified.txt'),0o755,'inspect/remove and retry restores exclusive creation after fixing server permissions');
  honorOpen=true;allowChmod=true;

  fs.mkdirSync(path.join(remote,'var','www','cms'),{recursive:true});fs.mkdirSync(path.join(local,'var','www','cms'),{recursive:true});modes.set('/var',0o755);modes.set('/var/www',0o775);modes.set('/var/www/cms',0o777);
  fs.writeFileSync(path.join(local,'var','www','cms','shared.php'),'shared SFTP upload');session.config.dirPerm=755;await engine.operate(session,'upload','var/www/cms/shared.php');delete session.config.dirPerm;
  assert.equal(fs.readFileSync(path.join(remote,'var','www','cms','shared.php'),'utf8'),'shared SFTP upload');assert.equal(modes.get('/var/www'),0o775);assert.equal(modes.get('/var/www/cms'),0o777);
  fs.mkdirSync(path.join(remote,'race'));modes.set('/race',0o755);fs.mkdirSync(path.join(local,'race'));fs.writeFileSync(path.join(local,'race','victim.txt'),'new payload');fs.writeFileSync(path.join(remote,'race','victim.txt'),'original');replaceOnClose=true;
  await assert.rejects(engine.operate(session,'upload','race/victim.txt'),/not a real directory/);assert.equal(renamesAfterRace,0);assert.equal(fs.readFileSync(path.join(remote,'race','victim.txt'),'utf8'),'original');replacedFolder=false;fs.rmSync(path.join(local,'race'),{recursive:true,force:true});fs.rmSync(path.join(remote,'race'),{recursive:true,force:true});modes.delete('/race');
  assert.equal((await engine.operate(session,'list')).some(item=>item.name==='wire.txt'),true);
  fs.writeFileSync(path.join(remote,'wire.txt'),'server change');await engine.operate(session,'download','wire.txt');assert.equal(fs.readFileSync(path.join(local,'wire.txt'),'utf8'),'server change');
  fs.mkdirSync(path.join(remote,'nested'));modes.set('/nested',0o755);fs.writeFileSync(path.join(remote,'nested','remote-only.txt'),'nested from server');
  fs.writeFileSync(path.join(remote,'remote-only.txt'),'from server');
  await engine.operate(session,'sync-both');
  assert.equal(fs.readFileSync(path.join(local,'remote-only.txt'),'utf8'),'from server');
  assert.equal(fs.readFileSync(path.join(local,'nested','remote-only.txt'),'utf8'),'nested from server');
  await engine.operate(session,'delete','wire.txt',{yes:true});assert.equal(fs.existsSync(path.join(remote,'wire.txt')),false);
  t.diagnostic('Completed transfers; checking established channel shutdown');
  const oldRemote=await session.service.getRemoteFileSystem(session.config);
  const beforeReconnect=elevatedChannels.length;
  const ended=new Promise(resolve=>oldRemote.getClient()._client.once('close',resolve));
  dropNextStat=true;
  await assert.rejects(oldRemote.lstat('/'),/No response|closed|end|connection/i);
  t.diagnostic('Transport closed; checking reconnection');
  const reconnected=await session.service.getRemoteFileSystem(session.config);
  assert.notEqual(reconnected,oldRemote);assert.equal(elevatedChannels.length,beforeReconnect+1);
  assert.equal((await reconnected.lstat('/')).type,engine.FileType.Directory);
  await ended;assert.equal(agentForwardRequests,0);

});

for(const failure of ['denied','closed','timeout','forced','eof','limits-eof'])test('Sudo SFTP startup '+failure+' fails without a normal subsystem fallback', {timeout:12000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-sudo-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
 const clients=new Set();let normal=0,executions=0,negotiated=0,limits=0;
 const server=new Server({hostKeys:[key]},client=>{
  clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));client.on('authentication',ctx=>ctx.method==='password'?ctx.accept():ctx.reject());
  client.on('ready',()=>client.on('session',accept=>accept().on('sftp',(_accept,reject)=>{normal++;reject();}).on('exec',(accept,reject,info)=>{
   executions++;assert.match(info.command,/^sudo -n/);
   if(failure==='denied'){reject();return;}
   const channel=accept();
   if(failure==='limits-eof'){
    const string=value=>{const body=Buffer.from(value),length=Buffer.alloc(4);length.writeUInt32BE(body.length);return Buffer.concat([length,body]);};
    let pending=Buffer.alloc(0),sent=false,challenge=false;
    channel.on('data',data=>{pending=Buffer.concat([pending,data]);if(!challenge){const nl=pending.indexOf(10);if(nl<0)return;const token=pending.subarray(0,nl).toString();assert.match(token,/^DEVKIT_SUDO_[a-f0-9]{48}$/);channel.stderr.write('fixture warning\n'+token+'\n');pending=pending.subarray(nl+1);challenge=true;}while(pending.length>=4&&pending.length>=4+pending.readUInt32BE()){
     const length=pending.readUInt32BE(),packet=pending.subarray(4,4+length);pending=pending.subarray(4+length);
     if(!sent){assert.equal(packet[0],1);sent=true;const body=Buffer.concat([Buffer.from([2,0,0,0,3]),string('limits@openssh.com'),string('1')]),prefix=Buffer.alloc(4);prefix.writeUInt32BE(body.length);channel.write(Buffer.concat([prefix,body]));}
     else{assert.equal(packet[0],200);limits++;channel.end();}
    }});return;
   }
   if(failure==='forced'){
    const {SFTP}=require('ssh2/lib/protocol/SFTP');const sftp=new SFTP(client,{type:channel.type,incoming:channel.incoming,outgoing:channel.outgoing},{server:true});channel.stderr.write(info.command);readSudoChallenge(sftp,channel,false);client._chanMgr.update(channel.incoming.id,sftp);sftp.once('ready',()=>negotiated++);return;
   }
   if(failure==='eof'){channel.end();return;}
   if(failure==='closed'){channel.stderr.write('untrusted remote text');channel.exit(1);channel.end();}
  })));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const client of clients)client.end();await new Promise(resolve=>server.close(resolve));});
 const session=engine.createSession(root,{host:'127.0.0.1',port:server.address().port,username:'fixture',password:'fixture',sudo:true,remotePath:'/',connectTimeout:700,hostFingerprint:engine.fingerprint(utils.parseKey(key).getPublicSSH())});
 t.after(()=>session.service.dispose());
 await assert.rejects(session.service.getRemoteFileSystem(session.config),error=>error.code==='SUDO_SFTP_START_FAILED'&&/non-interactive sudo/.test(error.message)&&!error.message.includes('untrusted remote text'));
 assert.equal(executions,1);assert.equal(normal,0);if(failure==='forced')assert.equal(negotiated,1);if(failure==='limits-eof')assert.equal(limits,1);
});
