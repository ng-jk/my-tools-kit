'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const {execute}=require('../src/logic/api');
async function fixture(t,handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return 'http://127.0.0.1:'+server.address().port;}
test('XML, GraphQL, duplicate query rows, disabled headers and form fields reach the wire',async t=>{
  const base=await fixture(t,async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);res.setHeader('content-type','application/json');res.setHeader('set-cookie','fixture=one; Path=/; HttpOnly');res.end(JSON.stringify({url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()}));});
  const xml=await execute({url:base,method:'POST',headers:[{name:'X-disabled',value:'no',enabled:false}],query:[{name:'q',value:'one'},{name:'q',value:'two'},{name:'skip',value:'no',enabled:false}],body:{type:'xml',value:'<test>yes</test>'}});
  assert.equal(xml.json.url,'/?q=one&q=two');assert.equal(xml.json.headers['x-disabled'],undefined);assert.equal(xml.json.headers['content-type'],'application/xml');assert.equal(xml.cookies[0].name,'fixture');assert.equal(xml.cookies[0].httpOnly,true);
  const graphql=await execute({url:base,method:'POST',body:{type:'graphql',query:'query Q($id:ID!){item(id:$id){id}}',variables:{id:'42'},operationName:'Q'}});
  assert.equal(JSON.parse(graphql.json.body).variables.id,'42');assert.equal(graphql.json.headers['content-type'],'application/json');
  const form=await execute({url:base,method:'POST',body:{type:'form',value:[{name:'x',value:'1'},{name:'skip',value:'2',enabled:false}]}});assert.equal(form.json.body,'x=1');
});
test('pre-request collections share extracted variables, scripts and cookies; cycles fail before traffic',async t=>{
  let count=0;const base=await fixture(t,(req,res)=>{count++;res.setHeader('content-type','application/json');if(req.url==='/login'){res.setHeader('set-cookie','session=fixture; Path=/');res.end('{"id":42}');}else res.end(JSON.stringify({url:req.url,cookie:req.headers.cookie}));});
  const collections=[{id:'auth',name:'Auth',version:1,requests:[{id:'login',name:'Login',url:base+'/login',extract:[{variable:'id',path:'id'}]}]}];
  const result=await execute({url:base+'/data?id={{id}}',preRequests:[{collectionId:'auth',requestId:'login'}],preScript:'request.headers={"x-fixture":"yes"};env.set("scriptRan",true);'},{collections,allowScripts:true});
  assert.equal(result.json.url,'/data?id=42');assert.equal(result.json.cookie,'session=fixture');assert.equal(result.variables.scriptRan,true);assert.equal(result.preResults.length,1);
  collections[0].requests[0].preRequests=[{collectionId:'auth',requestId:'login'}];const before=count;
  await assert.rejects(execute({url:base,preRequests:[{collectionId:'auth',requestId:'login'}]},{collections}),/cycle/);assert.equal(count,before);
});
test('AWS SigV4 signs explicit credentials and exact payload without using ambient credentials',async t=>{
  const base=await fixture(t,async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);res.setHeader('content-type','application/json');res.end(JSON.stringify({headers:req.headers,body:Buffer.concat(chunks).toString()}));});
  const result=await execute({url:base+'/items?a=two%20words',method:'POST',headers:{'x-amz-date':'20260101T000000Z'},body:{type:'json',value:'{"id":42}'},auth:{type:'aws',accessKeyId:'FIXTUREKEY',secretAccessKey:'fixture-signing-secret',sessionToken:'fixture-session',region:'us-east-1',service:'execute-api'}});
  assert.match(result.json.headers.authorization,/Credential=FIXTUREKEY\/20260101\/us-east-1\/execute-api\/aws4_request/);assert.equal(result.json.headers['x-amz-security-token'],'fixture-session');assert.equal(result.json.headers['x-amz-content-sha256'],undefined);
  assert.equal(result.json.body,'{"id":42}');assert.match(result.json.headers.authorization,/Signature=[a-f0-9]{64}$/);
});
test('NTLMv2 sends authenticated body once on the challenge socket with a valid response proof',async t=>{
  const challenge=crypto.randomBytes(8),sockets=new Set();let finals=0;
  const base=await fixture(t,async(req,res)=>{
    const message=Buffer.from((req.headers.authorization||'').replace(/^NTLM /,''),'base64'),type=message.length>12?message.readUInt32LE(8):0;
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    if(type===1){sockets.add(req.socket);assert.equal(Buffer.concat(chunks).length,0);const packet=Buffer.alloc(52);packet.write('NTLMSSP\0');packet.writeUInt32LE(2,8);packet.writeUInt32LE(0x00880201,20);challenge.copy(packet,24);packet.writeUInt16LE(4,40);packet.writeUInt16LE(4,42);packet.writeUInt32LE(48,44);res.writeHead(401,{'www-authenticate':'NTLM '+packet.toString('base64'),'content-length':'0'});res.end();return;}
    assert.equal(type,3);assert.ok(sockets.has(req.socket));finals++;
    const nt=message.subarray(message.readUInt32LE(24),message.readUInt32LE(24)+message.readUInt16LE(20));
    const md4=require('js-md4'),ntHash=Buffer.from(md4.arrayBuffer(Buffer.from('fixture-password','utf16le')));
    const hash=crypto.createHmac('md5',ntHash).update(Buffer.from('FIXTUREUSERDOMAIN','utf16le')).digest();
    assert.deepEqual(nt.subarray(0,16),crypto.createHmac('md5',hash).update(Buffer.concat([challenge,nt.subarray(16)])).digest());
    assert.equal(Buffer.concat(chunks).toString(),'payload');res.end('authenticated');
  });
  const result=await execute({url:base,method:'POST',body:{type:'text',value:'payload'},auth:{type:'ntlm',username:'fixtureuser',password:'fixture-password',domain:'DOMAIN',workstation:'FIXTURE'}});
  assert.equal(result.status,200);assert.equal(finals,1);
});
test('OAuth token exchange supports manual code/PKCE, password and refresh grants',async t=>{
  const grants=[];const base=await fixture(t,async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);res.setHeader('content-type','application/json');if(req.url==='/token'){grants.push(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString())));res.end('{"access_token":"fixture-token"}');}else res.end(JSON.stringify({authorization:req.headers.authorization}));});
  for(const auth of [{grantType:'authorization_code',code:'fixture-code',redirectUri:'http://127.0.0.1/callback',codeVerifier:'fixture-verifier'},{grantType:'password',username:'fixture',password:'fixture'},{grantType:'refresh_token',refreshToken:'fixture-refresh'}]){
    const result=await execute({url:base,auth:{type:'oauth2',tokenUrl:base+'/token',clientId:'fixture-client',...auth}});assert.equal(result.json.authorization,'Bearer fixture-token');
  }
  assert.equal(grants[0].code_verifier,'fixture-verifier');assert.equal(grants[1].username,'fixture');assert.equal(grants[2].refresh_token,'fixture-refresh');
});
test('plain-text documentation templates never affect outgoing requests',async t=>{
  const base=await fixture(t,(_req,res)=>res.end('sent'));
  const result=await execute({url:base,documentation:'Examples: {{customerId}} and {{secret.UNSTORED}} are plain text.'});
  assert.equal(result.status,200);assert.equal(result.body,'sent');
});
test('disabled and unnamed fields do not require variables or secrets',async t=>{
  const base=await fixture(t,async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);res.setHeader('content-type','application/json');res.end(JSON.stringify({url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()}));});
  for(const body of [{type:'form',value:[{name:'skip',value:'{{missing}}',enabled:false},{name:'',value:'{{missing}}'},{name:'yes',value:'one'}]},{type:'multipart',fields:[{name:'skip',file:'{{missing}}',enabled:false},{name:'',value:'{{missing}}'},{name:'yes',value:'one'}]}]){
    const result=await execute({url:base,method:'POST',headers:[{name:'Authorization',value:'{{secret.UNUSED}}',enabled:false}],query:[{name:'skip',value:'{{missing}}',disabled:true}],auth:{type:'none',token:'{{missing}}'},body});
    assert.equal(result.status,200);assert.equal(result.json.url,'/');assert.equal(result.json.headers.authorization,undefined);assert.equal(result.json.body.includes('{{missing}}'),false);
  }
  await assert.rejects(execute({url:base,method:'POST',body:{type:'multipart',fields:[{name:'file',file:''}]}}),/Multipart file path is required/);
  await assert.rejects(execute({url:base,method:'POST',body:{type:'binary',file:''}}),/Binary body requires/);
});
test('secret lookup follows only active variable chains within each collection',()=>{
  const {referencedSecrets}=require('../src/logic/api');
  const request={variables:{unused:'{{secret.UNUSED}}',token:'{{secret.NEEDED}}'},url:'https://example.invalid',headers:[{name:'skip',value:'{{unused}}',enabled:false}],auth:{type:'bearer',token:'{{token}}'}};
  assert.deepEqual(referencedSecrets([request],{}),['NEEDED']);
  assert.deepEqual(referencedSecrets([{...request,auth:{type:'none'},preScript:'env.get("token")'}],{}),['NEEDED']);
});
test('pre-request collection defaults cannot retarget requests or leak into another collection',async t=>{
  const seen=[];
  const auth=await fixture(t,(req,res)=>{seen.push(['auth',req.url,req.headers.authorization]);res.setHeader('content-type','application/json');res.end('{"token":"extracted-token"}');});
  const api=await fixture(t,(req,res)=>{seen.push(['api',req.url,req.headers.authorization]);res.end('main');});
  const collections=[{id:'auth',version:1,variables:{base:auth,credential:'auth-only'},requests:[{id:'login',url:'{{base}}/login',auth:{type:'bearer',token:'{{credential}}'},extract:[{variable:'token',path:'token'}],postScript:'env.set("published",env.get("credential"));'}]}];
  const request={url:'{{base}}/main?token={{token}}',auth:{type:'bearer',token:'{{credential}}'},preRequests:[{collectionId:'auth',requestId:'login'}]};
  const result=await execute(request,{collections,collectionVariables:{base:api,credential:'main-only'},variables:{},allowScripts:true});
  assert.deepEqual(seen,[['auth','/login','Bearer auth-only'],['api','/main?token=extracted-token','Bearer main-only']]);
  assert.equal(result.variables.published,'auth-only');assert.equal(result.variables.credential,'main-only');
});
test('NTLM does not mutate non-challenging endpoints or report an empty negotiation as success',async t=>{
  const methods=[];const base=await fixture(t,(req,res)=>{methods.push(req.method);res.end('anonymous endpoint');});
  await assert.rejects(execute({url:base,method:'POST',body:{type:'text',value:'must not be silently omitted'},auth:{type:'ntlm',username:'fixture',password:'fixture'}}),/negotiation was not offered.*No authenticated payload/);
  assert.deepEqual(methods,['HEAD']);
});
test('CLI --collections executes the same dependency extraction and cookie workflow',async t=>{
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-api-cli-deps-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const base=await fixture(t,(req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/login'){res.setHeader('set-cookie','session=fixture; Path=/');res.end('{"id":99}');}else res.end(JSON.stringify({url:req.url,cookie:req.headers.cookie}));});
  const request=path.join(root,'request.json'),library=path.join(root,'library.json');
  fs.writeFileSync(request,JSON.stringify({url:base+'/main?id={{id}}',preRequests:[{collectionId:'auth',requestId:'login'}]}));
  fs.writeFileSync(library,JSON.stringify([{id:'auth',version:1,requests:[{id:'login',url:base+'/login',extract:[{variable:'id',path:'id'}]}]}]));
  const result=await require('node:util').promisify(require('node:child_process').execFile)(process.execPath,[path.resolve(__dirname,'../cli.js'),'send',request,'--collections',library],{timeout:20000});
  const body=JSON.parse(result.stdout);assert.equal(body.json.url,'/main?id=99');assert.equal(body.json.cookie,'session=fixture');
});
