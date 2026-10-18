'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const net=require('node:net');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {spawn}=require('node:child_process');
const tls=require('node:tls');
const {run}=require('../build/sftp/database');
const i32=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;},i16=n=>{const b=Buffer.alloc(2);b.writeInt16BE(n);return b;};
const msg=(type,...data)=>{const body=Buffer.concat(data);return Buffer.concat([Buffer.from(type),i32(body.length+4),body]);};
const str=s=>Buffer.from(s+'\0');
function cli(args,env){return new Promise(resolve=>{const p=spawn(process.execPath,['cli.js','database',...args],{cwd:path.resolve(__dirname,'..'),env:{...process.env,...env}});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('close',code=>resolve({code,out,err}));});}
test('PostgreSQL wire and CLI connect, browse, execute, limit and redact failures',{timeout:20000},async t=>{
  const sockets=new Set(),queries=[],auth=[];let completedWrite=false;
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let pending=Buffer.alloc(0),startup=true;
    socket.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);
      if(startup){if(pending.length<4||pending.length<pending.readInt32BE(0))return;const length=pending.readInt32BE(0);pending=pending.subarray(length);startup=false;socket.write(msg('R',i32(3)));}
      while(pending.length>=5){const length=pending.readInt32BE(1);if(pending.length<length+1)return;const type=String.fromCharCode(pending[0]),body=pending.subarray(5,length+1);pending=pending.subarray(length+1);
        if(type==='p'){auth.push(body.toString().replace(/\0$/,''));socket.write(Buffer.concat([msg('R',i32(0)),msg('Z',Buffer.from('I'))]));}
        if(type==='Q'){
          const sql=body.toString().replace(/\0$/,'');queries.push(sql);
          if(['DELAYED_BATCH','ERROR_AFTER_LIMIT'].includes(sql)) {
            const field=Buffer.concat([str('first'),i32(0),i16(0),i32(25),i16(-1),i32(-1),i16(0)]);
            socket.write(Buffer.concat([msg('T',i16(1),field),...['1','2','3'].map(v=>msg('D',i16(1),i32(1),Buffer.from(v)))]));
            setTimeout(()=>{
              if(sql==='ERROR_AFTER_LIMIT')socket.write(Buffer.concat([msg('E',str('SERROR'),str('C42601'),str('Mfailure after result cutoff'),Buffer.from([0])),msg('Z',Buffer.from('I'))]));
              else {completedWrite=true;socket.write(Buffer.concat([msg('C',str('SELECT 3')),msg('C',str('UPDATE 1')),msg('Z',Buffer.from('I'))]));}
            },60);continue;
          }
          if(sql==='TWO_SHAPES') {
            const set=(name,value)=>{const field=Buffer.concat([str(name),i32(0),i16(0),i32(25),i16(-1),i32(-1),i16(0)]);return Buffer.concat([msg('T',i16(1),field),msg('D',i16(1),i32(1),Buffer.from(value)),msg('C',str('SELECT 1'))]);};
            socket.write(Buffer.concat([set('left','1'),set('right','2'),msg('Z',Buffer.from('I'))]));continue;
          }
          if(sql==='FAIL'){socket.write(Buffer.concat([msg('E',str('SERROR'),str('C42601'),str('MTEST_ONLY_PASSWORD should never escape'),Buffer.from([0])),msg('Z',Buffer.from('I'))]));continue;}
          const rows=sql==='MANY'?['1','2','3']:sql.includes('pg_database')?['app']:['1'];
          const field=Buffer.concat([str('name'),i32(0),i16(0),i32(25),i16(-1),i32(-1),i16(0)]);
          socket.write(Buffer.concat([msg('T',i16(1),field),...rows.map(v=>msg('D',i16(1),i32(Buffer.byteLength(v)),Buffer.from(v))),msg('C',str('SELECT '+rows.length)),msg('Z',Buffer.from('I'))]));
        }
        if(type==='X')socket.end();
      }
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));});
  const config={type:'postgres',host:'127.0.0.1',port:server.address().port,user:'fixture',database:'app',tls:false,timeout:2000,maxRows:2};
  assert.deepEqual((await run(config,'TEST_ONLY_PASSWORD','test')).rows,[['1']]);
  assert.deepEqual((await run(config,'TEST_ONLY_PASSWORD','databases')).rows,[['app']]);
  assert.equal((await run(config,'TEST_ONLY_PASSWORD','query',{sql:'MANY',confirmed:true})).truncated,true);
  const batch=await run(config,'TEST_ONLY_PASSWORD','query',{sql:'DELAYED_BATCH',confirmed:true});assert.equal(completedWrite,true,'truncation waits for the final write completion');assert.equal(batch.truncated,true);assert.equal(batch.results.length,2);assert.equal(batch.results[1].affectedRows,1);
  await assert.rejects(run(config,'TEST_ONLY_PASSWORD','query',{sql:'ERROR_AFTER_LIMIT',confirmed:true}),/42601/);
  const shapes=await run(config,'TEST_ONLY_PASSWORD','query',{sql:'TWO_SHAPES',confirmed:true});assert.deepEqual(shapes.results.map(r=>r.columns),[['left'],['right']]);assert.deepEqual(shapes.results.map(r=>r.rows),[[['1']],[['2']]]);
  await assert.rejects(run(config,'TEST_ONLY_PASSWORD','query',{sql:'FAIL',confirmed:true}),error=>!error.message.includes('TEST_ONLY_PASSWORD')&&/42601/.test(error.message));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-db-cli-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'db.json');fs.writeFileSync(file,JSON.stringify({...config,passwordEnv:'DEVKIT_DB_FIXTURE_PASSWORD'}));const sql=path.join(dir,'query.sql');fs.writeFileSync(sql,'SELECT 1');
  const args=['query','--config',file,'--sql-file',sql,'--allow-plaintext'];
  const denied=await cli(args,{DEVKIT_DB_FIXTURE_PASSWORD:'TEST_ONLY_PASSWORD'});assert.equal(denied.code,1);assert.match(denied.err,/confirmation/);
  const success=await cli([...args,'--yes'],{DEVKIT_DB_FIXTURE_PASSWORD:'TEST_ONLY_PASSWORD'});assert.equal(success.code,0,success.err);assert.deepEqual(JSON.parse(success.out).rows,[['1']]);
  assert.ok(auth.every(p=>p==='TEST_ONLY_PASSWORD'));assert.ok(queries.includes('SELECT 1'));
});
test('MySQL wire connects and browses through the upstream-derived adapter',{timeout:15000},async t=>{
  const mysql=require('mysql2'),server=mysql.createServer(),clients=new Set();
  const base=path.dirname(require.resolve('mysql2')),Packets=require(path.join(base,'lib/packets')),Packet=require(path.join(base,'lib/packets/packet'));
  const column={catalog:'def',schema:'app',table:'',orgTable:'',name:'name',orgName:'name',characterSet:45,columnLength:128,columnType:253,flags:0,decimals:0};
  const bound=[];
  server.on('connection',client=>{clients.add(client);client.on('error',()=>{});client.serverHandshake({serverVersion:'8.0.0-fixture',connectionId:1,characterSet:45,statusFlags:2,capabilityFlags:0x00088209,authCallback:(_,done)=>{done(null);queueMicrotask(()=>client._resetSequenceId());}});
    client.on('query',sql=>{client._sequenceId=1;assert.equal(client.clientHelloReply.clientFlags & 128,0,'local infile capability disabled');client.writeColumns([{catalog:'def',schema:'app',table:'',orgTable:'',name:'name',orgName:'name',characterSet:45,columnLength:128,columnType:253,flags:0,decimals:0}]);client.writeTextRow([sql.includes('DATABASES')?'app':'1']);client.writeEof();client._resetSequenceId();});
    client.on('quit',()=>client.close());
    client.on('stmt_prepare',sql=>{
      assert.match(sql,/information_schema/);assert.ok(sql.includes('?'));assert.equal(sql.includes('injected'),false);
      const count=(sql.match(/\?/g)||[]).length,buffer=Buffer.alloc(16);buffer[4]=0;buffer.writeUInt32LE(1,5);buffer.writeUInt16LE(1,9);buffer.writeUInt16LE(count,11);
      client._sequenceId=1;client.writePacket(new Packet(0,buffer,0,buffer.length));
      for(let i=0;i<count;i++)client.writePacket(Packets.ColumnDefinition.toPacket(column,client.serverConfig.encoding));client.writeEof();
      client.writePacket(Packets.ColumnDefinition.toPacket(column,client.serverConfig.encoding));client.writeEof();client._resetSequenceId();
    });
    client.on('stmt_execute',(_id,_flags,_count,values)=>{bound.push(values);client._sequenceId=1;client.writeColumns([column]);client.writeBinaryRow(['1']);client.writeEof();client._resetSequenceId();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const c of clients)c.destroy();await new Promise(resolve=>server.close(resolve));});
  const config={type:'mysql',host:'127.0.0.1',port:server._server.address().port,user:'fixture',database:'app',tls:false,timeout:2000};
  assert.deepEqual((await run(config,'TEST_ONLY_PASSWORD','test')).rows,[['1']]);
  assert.deepEqual((await run(config,'TEST_ONLY_PASSWORD','databases')).rows,[['app']]);
  assert.deepEqual((await run(config,'TEST_ONLY_PASSWORD','tables',{schema:'app'})).rows,[['1']]);
  assert.deepEqual((await run(config,'TEST_ONLY_PASSWORD','columns',{schema:'app',table:'t'})).rows,[['1']]);
  await run(config,'TEST_ONLY_PASSWORD','columns',{schema:'app',table:"injected'\\; DROP TABLE t; --"});assert.equal(bound.at(-1)[1],"injected'\\; DROP TABLE t; --");
  assert.deepEqual((await run(config,'TEST_ONLY_PASSWORD','query',{sql:'SELECT 1',confirmed:true})).rows,[['1']]);
});
test('PostgreSQL verified TLS encrypts authentication and rejects an untrusted certificate',{timeout:15000},async t=>{
  const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/ftps',name));
  const key=fixture('test-only-key.pem'),cert=fixture('test-only-cert.pem'),sockets=new Set();let authenticated=0;
  const context=tls.createSecureContext({key,cert});
  const server=net.createServer(raw=>{sockets.add(raw);raw.on('error',()=>{});raw.on('close',()=>sockets.delete(raw));
    raw.once('data',request=>{assert.equal(request.readInt32BE(4),80877103);raw.write('S');
      const secure=new tls.TLSSocket(raw,{isServer:true,secureContext:context});secure.on('error',()=>{});let pending=Buffer.alloc(0),startup=true;
      secure.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);
        if(startup){if(pending.length<4||pending.length<pending.readInt32BE(0))return;pending=pending.subarray(pending.readInt32BE(0));startup=false;secure.write(msg('R',i32(3)));}
        while(pending.length>=5){const size=pending.readInt32BE(1);if(pending.length<size+1)return;const type=String.fromCharCode(pending[0]),body=pending.subarray(5,size+1);pending=pending.subarray(size+1);
          if(type==='p'){assert.equal(secure.encrypted,true);assert.equal(body.toString(),'TEST_ONLY_PASSWORD\0');authenticated++;secure.write(Buffer.concat([msg('R',i32(0)),msg('Z',Buffer.from('I'))]));}
          if(type==='Q')secure.write(Buffer.concat([msg('C',str('SELECT 0')),msg('Z',Buffer.from('I'))]));
          if(type==='X')secure.end();
        }
      });
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));});
  const config={type:'postgres',host:'127.0.0.1',port:server.address().port,user:'fixture',database:'app',timeout:2000};
  await assert.rejects(run(config,'TEST_ONLY_PASSWORD','test'),/Database operation failed/);assert.equal(authenticated,0);
  await run({...config,caPath:path.join(__dirname,'fixtures/ftps/test-only-cert.pem')},'TEST_ONLY_PASSWORD','test');assert.equal(authenticated,1);
});
test('MySQL TLS verifies IP SAN before credentials, rejects wrong host and untrusted CA',{timeout:15000},async t=>{
  const Handshake=require(path.join(path.dirname(require.resolve('mysql2')),'lib/packets/handshake'));
  const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/ftps',name));
  const key=fixture('test-only-key.pem'),sockets=new Set(),servers=new Set();let wrong=false,authenticated=0;
  const packet=(body,sequence)=>{const header=Buffer.alloc(4);header.writeUIntLE(body.length,0,3);header[3]=sequence;return Buffer.concat([header,body]);};
  const track=socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));};
  const server=net.createServer(raw=>{track(raw);
    const hello=new Handshake({protocolVersion:10,serverVersion:'8.0.0-fixture',connectionId:1,characterSet:45,statusFlags:2,capabilityFlags:0x00088a09});
    hello.setScrambleData(error=>{if(error)return raw.destroy();const p=hello.toPacket(0);p.writeHeader(0);raw.write(p.buffer);});
    raw.once('data',request=>{assert.ok(request.length>=36);assert.ok(request.readUInt32LE(4)&0x800);raw.pause();
      const backend=tls.createServer({key,cert:fixture(wrong?'test-only-wrong-host-cert.pem':'test-only-cert.pem')},secure=>{
        let pending=Buffer.alloc(0),auth=false;
        secure.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);while(pending.length>=4){const size=pending.readUIntLE(0,3);if(pending.length<size+4)return;const body=pending.subarray(4,size+4);pending=pending.subarray(size+4);
          if(!auth){authenticated++;auth=true;assert.equal(secure.encrypted,true);secure.write(packet(Buffer.from([0,0,0,2,0,0,0]),3));}
          else if(body[0]===3)secure.write(packet(Buffer.from([0,0,0,2,0,0,0]),1));
        }});
      });
      servers.add(backend);backend.on('connection',track);backend.on('tlsClientError',()=>{});
      backend.listen(0,'127.0.0.1',()=>{
        const upstream=net.connect(backend.address().port,'127.0.0.1',()=>{upstream.write(request.subarray(36));raw.pipe(upstream);upstream.pipe(raw);raw.resume();});track(upstream);raw.on('close',()=>upstream.destroy());
      });
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.add(server);t.after(async()=>{for(const s of sockets)s.destroy();for(const srv of servers)await new Promise(resolve=>srv.close(resolve));});
  const config={type:'mysql',host:'127.0.0.1',port:server.address().port,user:'fixture',database:'app',timeout:2000};
  await assert.rejects(run(config,'TEST_ONLY_PASSWORD','test'),/Database operation failed/);assert.equal(authenticated,0);
  await run({...config,caPath:path.join(__dirname,'fixtures/ftps/test-only-cert.pem')},'TEST_ONLY_PASSWORD','test');assert.equal(authenticated,1);
  wrong=true;await assert.rejects(run({...config,caPath:path.join(__dirname,'fixtures/ftps/test-only-wrong-host-cert.pem')},'TEST_ONLY_PASSWORD','test'),/Database operation failed/);assert.equal(authenticated,1);
});
