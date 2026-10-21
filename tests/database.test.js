'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {connection,statement,run}=require('../src/logic/database');
const {sslOptions}=require('../src/data/database/driver');
const raw={type:'postgres',host:'db.example.test',user:'reader',database:'app'};
test('database validation enforces bounded connections and verified TLS',()=>{
  const c=connection(raw);assert.equal(c.port,5432);assert.equal(c.tls,true);assert.equal(sslOptions(c).rejectUnauthorized,true);assert.equal(sslOptions(c).verifyIdentity,true);
  assert.equal(sslOptions({...c,tls:false}),undefined);
  for(const extra of [{port:0},{maxRows:999999},{timeout:999999},{host:'postgres://user:secret@host'},{user:'bad\nuser'},{type:'redis'}])assert.throws(()=>connection({...raw,...extra}));
  assert.equal(connection({...raw,password:'not-persisted'}).password,undefined);
});
test('metadata values are bound and preview identifiers cannot inject SQL',()=>{
  const c=connection(raw),evil='x\"; DROP TABLE victim; --';
  const [sql,values]=statement(c,'columns',{schema:evil,table:evil});assert.equal(sql.includes(evil),false);assert.deepEqual(values,[evil,evil]);
  assert.match(statement(c,'preview',{schema:'public',table:evil})[0],/"x""; DROP TABLE victim; --" LIMIT 501$/);
  assert.deepEqual(statement(c,'tables')[1],['public']);
  assert.deepEqual(statement(c,'tables',{schema:'public',filter:'%name%'} )[1],['public','%name%']);
  assert.deepEqual(statement(c,'databases',{filter:'app%'} )[1],['app%']);
  assert.equal(statement(c,'databases',{filter:"bad'"})[0].includes("bad'"),false);
  assert.match(statement(connection({...raw,type:'mysql'}),'preview',{schema:'app',table:'a`b'})[0],/`a``b`/);
  assert.throws(()=>statement(c,'query',{sql:'DELETE FROM t'}),/confirmation/);
});
test('shared database logic passes the same operation to a data adapter without UI',async()=>{
  const calls=[];const adapter={execute:async(...args)=>{calls.push(args);return {columns:['value'],rows:[[1]]};}};
  const result=await run(raw,'TEST_ONLY_PASSWORD','query',{sql:'SELECT 1',confirmed:true},adapter);
  assert.deepEqual(result.rows,[[1]]);assert.equal(calls[0][1],'TEST_ONLY_PASSWORD');assert.equal(calls[0][2],'SELECT 1');assert.equal(calls[0][0].password,undefined);
});

test('PostgreSQL query schema is validated and passed to the shared data adapter',async()=>{
 const calls=[],adapter={execute:async c=>{calls.push(c);return {};}};
 for(const schema of ['public','tenant_b','odd"; DROP TABLE users; --']){await run(raw,'','query',{sql:'SELECT * FROM users',confirmed:true,schema},adapter);assert.equal(calls.at(-1).querySchema,schema);}
 await assert.rejects(run(raw,'','query',{sql:'SELECT 1',confirmed:true,schema:'bad\nschema'},adapter),/identifier/);
 await assert.rejects(run({...raw,type:'mysql'},'','query',{sql:'SELECT 1',confirmed:true,schema:'other'},adapter),/only for PostgreSQL/);
});
