'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const engine=require('../build/sftp/engine');
const tls=require('node:tls');

test('implicit FTPS keeps authentication and passive data in verified TLS',{timeout:20000},async t=>{
  const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures','ftps',name));
  const key=fixture('test-only-key.pem'),cert=fixture('test-only-cert.pem'),wrong=fixture('test-only-wrong-host-cert.pem');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-ftps-')),sockets=new Set(),servers=new Set(),sessions=[];
  const commands=[],wire=[];let wrongData=false,tlsDataConnections=0;
  const track=server=>{servers.add(server);server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});server.on('tlsClientError',()=>{});return server;};
  const control=track(tls.createServer({key,cert},socket=>{
    assert.equal(socket.encrypted,true);let pending='',dataReady;
    const reply=message=>socket.write(message+'\r\n');reply('220 TLS fixture');
    socket.on('data',chunk=>{pending+=chunk.toString();let end;
      while((end=pending.indexOf('\r\n'))!==-1){
        const line=pending.slice(0,end);pending=pending.slice(end+2);commands.push(line);
        const cmd=line.split(' ')[0];
        if(cmd==='PBSZ'||cmd==='PROT'||cmd==='TYPE'||cmd==='NOOP')reply('200 OK');
        else if(cmd==='USER')reply('331 Password required');
        else if(cmd==='PASS')reply(line==='PASS TEST_ONLY_FTPS_PASSWORD'?'230 Logged in':'530 Rejected');
        else if(cmd==='FEAT')reply('211 End');
        else if(cmd==='PWD')reply('257 "/"');
        else if(cmd==='CWD')reply('250 Changed');
        else if(cmd==='PASV'){
          let resolve;dataReady=new Promise(done=>resolve=done);
          const data=track(tls.createServer({key,cert:wrongData?wrong:cert,sessionIdContext:wrongData?'wrong-host':'valid-data'},secure=>{tlsDataConnections++;assert.equal(secure.encrypted,true);resolve(secure);data.close();}));
          data.listen(0,'127.0.0.1',()=>{const port=data.address().port;reply(`227 Entering Passive Mode (127,0,0,1,${Math.floor(port/256)},${port%256})`);});
        } else if(cmd==='LIST'){
          reply('150 Listing');dataReady.then(data=>data.end('-rw------- 1 user group 4 Jan 01 2026 secure.txt\r\n',()=>reply('226 Done')));
        } else if(cmd==='ABOR')reply('225 Aborted');
        else if(cmd==='QUIT'){reply('221 Bye');socket.end();}
        else reply('502 Unsupported');
      }
    });
  }));
  await new Promise(resolve=>control.listen(0,'127.0.0.1',resolve));
  const proxy=track(net.createServer(peer=>{
    const upstream=net.connect(control.address().port,'127.0.0.1');sockets.add(upstream);upstream.on('error',()=>peer.destroy());upstream.on('close',()=>sockets.delete(upstream));
    peer.on('data',chunk=>{wire.push(Buffer.from(chunk));upstream.write(chunk);});upstream.pipe(peer);peer.on('close',()=>upstream.destroy());
  }));
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const session of sessions)session.service.dispose();for(const socket of sockets)socket.destroy();for(const server of servers)if(server.listening)await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  const make=secureOptions=>{const session=engine.createSession(root,{protocol:'ftp',secure:'implicit',secureOptions,host:'127.0.0.1',port:proxy.address().port,username:'TEST_ONLY_FTPS_USER',password:'TEST_ONLY_FTPS_PASSWORD',remotePath:'/',connectTimeout:3000});sessions.push(session);return session;};
  const good=make({ca:[cert,wrong]});
  const remote=await good.service.getRemoteFileSystem(good.config);
  const entries=await remote.list('/');assert.ok(entries.some(item=>item.name==='secure.txt'));
  assert.ok(commands.includes('PBSZ 0'));assert.ok(commands.includes('PROT P'));assert.ok(commands.includes('PASS TEST_ONLY_FTPS_PASSWORD'));assert.ok(tlsDataConnections>0);
  const raw=Buffer.concat(wire);assert.equal(raw.includes(Buffer.from('TEST_ONLY_FTPS_USER')),false);assert.equal(raw.includes(Buffer.from('TEST_ONLY_FTPS_PASSWORD')),false);
  const before=commands.length;const untrusted=make({});
  await assert.rejects(untrusted.service.getRemoteFileSystem(untrusted.config),/certificate|self.signed|verify/i);assert.equal(commands.length,before,'invalid control certificate sends no credentials');
  wrongData=true;const lists=commands.filter(line=>line.startsWith('LIST')).length;
  await assert.rejects(remote.list('/'),/certificate|hostname|altnames|IP/i);
  assert.equal(commands.filter(line=>line.startsWith('LIST')).length,lists,'invalid data certificate rejects before sending a transfer command');
});
test('FTP wire: passive upload, listing and download share the transfer engine',{timeout:20000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-ftp-'));
  fs.writeFileSync(path.join(root,'local.txt'),'ftp payload');
  let referentReads=0;const linkTargets=new Map([['/.hidden-link','/outside/private']]);
  const files=new Map([['/nul',Buffer.from('valid remote sibling')],['/.hidden.txt',Buffer.from('hidden original')],['/.hidden-link',Buffer.from('link placeholder')]]),modes=new Map(),directories=new Set(),payloadParents=[],commands=[],sockets=new Set(),servers=new Set();let permissionsSupported=true,permissionsHonored=true,filePermissionsHonored=true,failStore=false;
  const rights=mode=>[6,3,0].map(shift=>[4,2,1].map((bit,index)=>((mode>>shift)&bit)?'rwx'[index]:'-').join('')).join('');
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    const reply=message=>socket.write(message+'\r\n');let pending='',dataSocket,renameFrom;
    reply('220 Fixture ready');
    socket.on('data',chunk=>{
      pending+=chunk.toString();let end;
      while((end=pending.indexOf('\r\n'))!==-1){
        const line=pending.slice(0,end);pending=pending.slice(end+2);const space=line.indexOf(' ');const cmd=space<0?line:line.slice(0,space),arg=space<0?'':line.slice(space+1);commands.push(cmd);
        if(cmd==='USER')reply('331 Password required');
        else if(cmd==='PASS')reply(arg==='fixture'?'230 Logged in':'530 Rejected');
        else if(cmd==='FEAT')reply('211 End');
        else if(cmd==='SYST')reply('215 UNIX Type: L8');
        else if(cmd==='PWD')reply('257 "/"');
        else if(['TYPE','OPTS','NOOP'].includes(cmd))reply('200 OK');
        else if(cmd==='CWD')reply('250 Changed');
        else if(cmd==='PASV'){
          const data=net.createServer(s=>{dataSocket=s;sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));data.close();});servers.add(data);
          data.listen(0,'127.0.0.1',()=>{const port=data.address().port;reply('227 Entering Passive Mode (127,0,0,1,'+Math.floor(port/256)+','+(port%256)+')');});
        }else if(cmd==='APPE'||cmd==='REST'){
          reply('550 Append/Restart not permitted, try again');dataSocket?.destroy();
        }else if(cmd==='STOR'){
          reply('150 Receiving');const chunks=[];dataSocket.on('data',b=>chunks.push(b));dataSocket.on('end',()=>{const body=Buffer.concat(chunks);payloadParents.push(modes.get(path.posix.dirname(arg)));files.set(arg,body);modes.set(arg,0o644);dataSocket.end();reply(failStore?'451 Simulated transfer failure':'226 Done');});dataSocket.resume();
        }else if(cmd==='RETR'){
          if(linkTargets.has(arg)){referentReads++;reply('550 Symlink must not be dereferenced');dataSocket.destroy();}else if(!files.has(arg)){reply('550 Missing');dataSocket.destroy();}else{reply('150 Sending');dataSocket.end(files.get(arg),()=>reply('226 Done'));}
        }else if(cmd==='LIST'){
          reply('150 Listing');let names=[...files.keys(),...directories];const target=arg.replace(/^-al\s*/, '');if(!arg.startsWith('-al '))names=names.filter(name=>!path.posix.basename(name).startsWith('.'));names=names.filter(name=>path.posix.dirname(name)===(target||'/'));
          const listing=names.map(name=>(directories.has(name)?'d':linkTargets.has(name)?'l':'-')+rights(modes.get(name)||0o644)+' 1 user group '+(files.get(name)?.length||0)+' Jan 01 2026 '+path.posix.basename(name)+(linkTargets.has(name)?' -> '+linkTargets.get(name):'')+'\r\n').join('');dataSocket.end(listing,()=>reply('226 Done'));
        }else if(cmd==='MKD'){
          if(files.has(arg)||directories.has(arg))reply('550 Already exists');else{directories.add(arg);modes.set(arg,0o755);reply('257 Directory created');}
        }else if(cmd==='RMD'){
          if([...files.keys(),...directories].some(name=>name!==arg&&name.startsWith(arg+'/')))reply('550 Not empty');else{directories.delete(arg);modes.delete(arg);reply('250 Removed');}
        }else if(cmd==='SIZE')reply(files.has(arg)?'213 '+files.get(arg).length:'550 Missing');
        else if(cmd==='MDTM')reply(files.has(arg)?'213 20260101000000':'550 Missing');
        else if(cmd==='MFMT')reply('213 Modified');
        else if(cmd==='SITE'){const match=/^CHMOD ([0-7]+) (.+)$/.exec(arg);if(!permissionsSupported||!match)reply('502 Unsupported');else{if(permissionsHonored&&(!files.has(match[2])||filePermissionsHonored))modes.set(match[2],parseInt(match[1],8));reply('200 Permissions set');}}
        else if(cmd==='RNFR'){renameFrom=arg;reply(files.has(arg)?'350 Rename ready':'550 Missing');}
        else if(cmd==='RNTO'){linkTargets.delete(arg);files.set(arg,files.get(renameFrom));files.delete(renameFrom);modes.set(arg,modes.get(renameFrom));modes.delete(renameFrom);reply('250 Renamed');}
        else if(cmd==='DELE'){files.delete(arg);modes.delete(arg);reply('250 Deleted');}
        else if(cmd==='QUIT'){reply('221 Bye');socket.end();}
        else reply('502 Unsupported');
      }
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const session=engine.createSession(root,{protocol:'ftp',host:'127.0.0.1',port:server.address().port,username:'fixture',password:'fixture',remotePath:'/'});
  t.after(async()=>{session.service.dispose();for(const socket of sockets)socket.destroy();for(const data of servers)if(data.listening)data.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  await assert.rejects(engine.operate(session,'upload','local.txt'),/FTP cannot establish destination type or absence/);
  assert.equal(files.has('/local.txt'),false,'ambiguous FTP absence cannot authorize an overwrite');
  files.set('/local.txt',Buffer.from('previous payload'));
  await engine.operate(session,'upload','local.txt');assert.equal(files.get('/local.txt').toString(),'ftp payload');
  const backup=engine.defaultBackupPath(session.service.workspace,session.service.baseDir,session.config,session.service.profile);
  t.after(()=>fs.rmSync(backup,{recursive:true,force:true}));
  for(const name of ['.hidden.txt','.hidden-link']){fs.writeFileSync(path.join(root,name),'hidden replacement');await engine.operate(session,'upload',name);assert.equal(files.get('/'+name).toString(),'hidden replacement');}
  assert.equal(referentReads,0,'hidden symlinks are backed up as metadata, never RETR');
  const git=require('isomorphic-git'),oid=await git.resolveRef({fs,dir:backup,ref:'HEAD'});
  assert.equal(Buffer.from((await git.readBlob({fs,dir:backup,oid,filepath:'.hidden-link'})).blob).toString(),'/outside/private');
  assert.equal(files.get('/nul').toString(),'valid remote sibling','reserved Windows names on the server do not block or change uploads');
  if(process.platform==='win32')await assert.rejects(engine.operate(session,'download','nul'),/Windows reserved device name/);
  modes.set('/local.txt',0o600);fs.writeFileSync(path.join(root,'local.txt'),'ftp payload');
  await engine.operate(session,'upload','local.txt');assert.equal(modes.get('/local.txt'),0o600);assert.equal(payloadParents.at(-1),0o700);
  modes.set('/local.txt',0o644);session.config.filePerm=600;
  await engine.operate(session,'upload','local.txt');assert.equal(modes.get('/local.txt'),0o600);assert.equal(payloadParents.at(-1),0o700);delete session.config.filePerm;
  permissionsSupported=false;const appended=payloadParents.length;
  await assert.rejects(engine.operate(session,'upload','local.txt'),/Unsupported|permission/i);
  assert.equal(payloadParents.length,appended);assert.equal(files.get('/local.txt').toString(),'ftp payload');permissionsSupported=true;
  permissionsHonored=false;await assert.rejects(engine.operate(session,'upload','local.txt'),/required file permissions/);assert.equal(payloadParents.length,appended);permissionsHonored=true;
  modes.set('/local.txt',0o600);filePermissionsHonored=false;
  await assert.rejects(engine.operate(session,'upload','local.txt'),/required file permissions/);
  assert.equal(files.get('/local.txt').toString(),'ftp payload','post-STOR mode mismatch preserves original');filePermissionsHonored=true;
  failStore=true;await assert.rejects(engine.operate(session,'upload','local.txt'),/Simulated transfer failure/);failStore=false;
  assert.equal(files.get('/local.txt').toString(),'ftp payload','failed STOR preserves original');
  assert.equal(commands.includes('APPE'),false);assert.equal(commands.includes('REST'),false);assert.ok(payloadParents.length>0&&payloadParents.every(mode=>mode===0o700));assert.equal(directories.size,0,'private directories are removed after success and failure');
  const list=await engine.operate(session,'list');assert.ok(list.some(item=>item.name==='local.txt'));
  const remoteFs=await session.service.getRemoteFileSystem(session.config);
  for(const relative of ['.','./']) assert.equal((await remoteFs.lstat(relative)).type,engine.FileType.Directory);
  await assert.rejects(remoteFs.rename('/local.txt\r\nDELE /local.txt\r\nNOOP','/renamed.txt'),/prohibited control/);
  assert.equal(files.get('/local.txt').toString(),'ftp payload');
  await assert.rejects(remoteFs.symlink('local.txt','/link'),/does not support/);
  await assert.rejects(engine.operate(session,'create','new.txt'),/exclusive file creation/);assert.equal(files.has('/new.txt'),false);
  await assert.rejects(engine.operate(session,'create','local.txt'),/exists/);
  files.set('/local.txt',Buffer.from('ftp server edit'));await engine.operate(session,'download','local.txt');assert.equal(fs.readFileSync(path.join(root,'local.txt'),'utf8'),'ftp server edit');
});
