'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const engine=require('../build/sftp/engine');
test('FTP wire: passive upload, listing and download share the transfer engine',{timeout:20000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-ftp-'));
  fs.writeFileSync(path.join(root,'local.txt'),'ftp payload');
  const files=new Map(),sockets=new Set(),servers=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    const reply=message=>socket.write(message+'\r\n');let pending='',dataSocket,renameFrom;
    reply('220 Fixture ready');
    socket.on('data',chunk=>{
      pending+=chunk.toString();let end;
      while((end=pending.indexOf('\r\n'))!==-1){
        const line=pending.slice(0,end);pending=pending.slice(end+2);const space=line.indexOf(' ');const cmd=space<0?line:line.slice(0,space),arg=space<0?'':line.slice(space+1);
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
        }else if(cmd==='STOR'){
          reply('150 Receiving');const chunks=[];dataSocket.on('data',b=>chunks.push(b));dataSocket.on('end',()=>{files.set(arg,Buffer.concat(chunks));dataSocket.end();reply('226 Done');});dataSocket.resume();
        }else if(cmd==='RETR'){
          if(!files.has(arg)){reply('550 Missing');dataSocket.destroy();}else{reply('150 Sending');dataSocket.end(files.get(arg),()=>reply('226 Done'));}
        }else if(cmd==='LIST'){
          reply('150 Listing');let names=[...files.keys()];const target=arg.replace(/^-al\s*/, '');if(target&&target!=='/')names=names.filter(name=>name===target);
          const listing=names.map(name=>'-rw-r--r-- 1 user group '+files.get(name).length+' Jan 01 2026 '+path.posix.basename(name)+'\r\n').join('');dataSocket.end(listing,()=>reply('226 Done'));
        }else if(cmd==='SIZE')reply(files.has(arg)?'213 '+files.get(arg).length:'550 Missing');
        else if(cmd==='MDTM')reply(files.has(arg)?'213 20260101000000':'550 Missing');
        else if(cmd==='MFMT')reply('213 Modified');
        else if(cmd==='RNFR'){renameFrom=arg;reply(files.has(arg)?'350 Rename ready':'550 Missing');}
        else if(cmd==='RNTO'){files.set(arg,files.get(renameFrom));files.delete(renameFrom);reply('250 Renamed');}
        else if(cmd==='DELE'){files.delete(arg);reply('250 Deleted');}
        else if(cmd==='QUIT'){reply('221 Bye');socket.end();}
        else reply('502 Unsupported');
      }
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const session=engine.createSession(root,{protocol:'ftp',host:'127.0.0.1',port:server.address().port,username:'fixture',password:'fixture',remotePath:'/'});
  t.after(async()=>{session.service.dispose();for(const socket of sockets)socket.destroy();for(const data of servers)if(data.listening)data.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  await engine.operate(session,'upload','local.txt');assert.equal(files.get('/local.txt').toString(),'ftp payload');
  const list=await engine.operate(session,'list');assert.ok(list.some(item=>item.name==='local.txt'));
  const remoteFs=await session.service.getRemoteFileSystem(session.config);
  await assert.rejects(remoteFs.rename('/local.txt\r\nDELE /local.txt\r\nNOOP','/renamed.txt'),/prohibited control/);
  assert.equal(files.get('/local.txt').toString(),'ftp payload');
  await assert.rejects(remoteFs.symlink('local.txt','/link'),/does not support/);
  await engine.operate(session,'create','new.txt');assert.equal(files.get('/new.txt').length,0);
  await assert.rejects(engine.operate(session,'create','local.txt'),/exists/);
  files.set('/local.txt',Buffer.from('ftp server edit'));await engine.operate(session,'download','local.txt');assert.equal(fs.readFileSync(path.join(root,'local.txt'),'utf8'),'ftp server edit');
});
