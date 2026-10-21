'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {activateBrowser}=require('../src/interface/database-browser');
const ui=require('../src/interface/database-workbench');
test('database workbench shares metadata/query operations, retains credentials safely and rejects stale editors',async()=>{
  const commands=new Map(),panels=[],secrets=new Map(),calls=[];let saved=[],trusted=true,confirmation='Execute SQL',fail=false;
  class EventEmitter {event=()=>({dispose(){}});fire(){}dispose(){}}
  const vscode={EventEmitter,ThemeIcon:class{constructor(id){this.id=id;}},ViewColumn:{One:1},commands:{registerCommand(id,fn){commands.set(id,fn);return {dispose(){}};},async executeCommand(id){calls.push(['command',id]);}},window:{
    registerTreeDataProvider(id,p){assert.equal(id,'devkit.databaseExplorer');return {dispose(){}};},
    createWebviewPanel(type,title,column,options){const listeners=[],dispose=[];const p={title,options,reveal(){p.revealed=true;},dispose(){dispose.forEach(fn=>fn());},onDidDispose(fn){dispose.push(fn);},webview:{html:'',messages:[],postMessage(m){this.messages.push(m);},onDidReceiveMessage(fn){listeners.push(fn);}},async send(m){for(const fn of listeners)await fn(m);}};panels.push(p);return p;},
    async showWarningMessage(){return confirmation;},async showErrorMessage(message){calls.push(['error',message]);}}};
  const context={subscriptions:[],secrets:{async store(k,v){secrets.set(k,v);},async get(k){return secrets.get(k);},async delete(k){secrets.delete(k);}}};
  const api={trust(){if(!trusted)throw new Error('Trust required');},profiles:()=>saved,async save(v){saved=v;},async test(c,password){calls.push(['test',c,password]);if(fail)throw new Error('Synthetic test failure');},async chooseMetadata(){return 'known_table';},async invoke(p,action,args,config){if(!trusted)throw new Error('Trust required');assert.ok(saved.some(v=>v.id===p.id));calls.push([action,p,args,config]);return {columns:['name'],rows:action==='databases'?[['app']]:action==='tables'?[['users','BASE TABLE']]:action==='schemas'?[['public']]:[['value']],truncated:false};}};
  const b=activateBrowser(vscode,context,api),values={name:'Remote test',type:'postgres',host:'db.example.test',port:5432,user:'reader',password:'TEST_ONLY_WORKBENCH_PASSWORD',database:'postgres',tls:true,timeout:15000,maxRows:500};
  b.edit();const editor=panels.at(-1);assert.equal(editor.options.retainContextWhenHidden,true);assert.ok(!editor.webview.html.includes(values.password));
  await editor.send({type:'test',values});assert.equal(saved.length,0);assert.equal(secrets.size,0);assert.equal(calls.at(-1)[0],'test');
  fail=true;await editor.send({type:'connect',values});assert.equal(saved.length,0);assert.match(editor.webview.messages.at(-1).text,/failure/);fail=false;
  await editor.send({type:'save',values});assert.equal(saved.length,1);const first=saved[0];assert.equal(secrets.size,1);assert.ok(!JSON.stringify(saved).includes(values.password));
  b.edit();assert.notEqual(panels.at(-1),editor,'Add after Save creates another independent connection editor');panels.at(-1).dispose();
  const roots=await b.provider.getChildren();assert.equal(roots[0].label,'Remote test');const databases=await b.provider.getChildren(roots[0]);assert.equal(databases[0].label,'app');
  const schemas=await b.provider.getChildren(databases[0]);assert.equal(schemas[0].label,'New SQL query');const tables=await b.provider.getChildren(schemas[1]);assert.equal(tables[1].label,'users');
  await commands.get('devkit.database.preview')(tables[1]);const preview=panels.at(-1);await preview.send({type:'ready'});assert.equal(preview.webview.messages.at(-1).type,'result');assert.equal(calls.findLast(c=>c[0]==='preview')[3].database,'app');
  await commands.get('devkit.database.find')(schemas[1]);assert.equal((await b.provider.getChildren(schemas[1]))[1].label,'known_table');
  b.query(first,{...first.config,database:'app'},'SELECT 1');const query=panels.at(-1);assert.ok(query.webview.html.includes('SELECT 1'));b.query(first,{...first.config,database:'app'},'other text');assert.equal(panels.at(-1),query);assert.ok(query.revealed);
  const schemaQueries=[];
  for(const schema of ['public','tenant_b']){await commands.get('devkit.database.nodeQuery')({...schemas[1],args:{schema}});const panel=panels.at(-1);schemaQueries.push(panel);await panel.send({type:'query',sql:'SELECT * FROM users'});assert.equal(calls.at(-1)[2].schema,schema);assert.ok(panel.webview.html.includes('schema '+schema));}
  assert.notEqual(schemaQueries[0],schemaQueries[1],'identically named tables in different schemas use distinct query editors');
  const queriesBeforeCancel=calls.filter(c=>c[0]==='query').length;
  confirmation=undefined;await query.send({type:'query',sql:'DELETE FROM users'});assert.equal(calls.filter(c=>c[0]==='query').length,queriesBeforeCancel);
  confirmation='Execute SQL';await query.send({type:'query',sql:'SELECT 1'});assert.equal(calls.at(-1)[0],'query');assert.equal(calls.at(-1)[2].confirmed,true);
  await editor.send({type:'save',values:{...values,password:'',host:'new.example.test'}});assert.equal(saved.length,1);assert.notEqual(saved[0].id,first.id);assert.equal([...secrets.values()][0],values.password);
  const queries=calls.filter(c=>c[0]==='query').length;await query.send({type:'query',sql:'SELECT 1'});assert.equal(calls.filter(c=>c[0]==='query').length,queries);assert.match(query.webview.messages.at(-1).text,/changed or was removed/);
  trusted=false;await editor.send({type:'save',values});assert.equal(saved[0].config.host,'new.example.test');assert.match(editor.webview.messages.at(-1).text,/Trust/);trusted=true;
  await editor.send({type:'save',values:{...values,port:0}});assert.match(editor.webview.messages.at(-1).text,/port/);assert.equal(saved[0].config.host,'new.example.test');
  confirmation=undefined;const tests=calls.filter(c=>c[0]==='test').length;await editor.send({type:'test',values:{...values,tls:false}});assert.equal(calls.filter(c=>c[0]==='test').length,tests);
  secrets.clear();await editor.send({type:'save',values:{...values,password:''}});assert.match(editor.webview.messages.at(-1).text,/password is missing/);
});
test('database pages escape untrusted names and SQL and forbid external content',()=>{
  const attack='</textarea><script>alert(1)</script>',p={name:attack,config:{type:'mysql',host:'db.example.test'}};
  for(const html of [ui.connectionPage(p),ui.queryPage(p,p.config,attack),ui.resultPage(attack)]){assert.ok(html.includes("default-src 'none'"));assert.ok(!html.includes(attack));assert.ok(html.includes('&lt;script&gt;'));const script=html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];assert.doesNotThrow(()=>new Function(script));}
});

test('database tree context actions are scoped to Database connections',()=>{
  const items=require('../package.json').contributes.menus['view/item/context'].filter(item=>item.command.startsWith('devkit.database.'));assert.equal(items.length,3);for(const item of items){assert.ok(item.when.includes('view == devkit.databaseExplorer'));assert.ok(item.when.includes('viewItem == databaseConnection'));}
});
