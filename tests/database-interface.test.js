'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
test('database UI saves credentials only in secrets and cancels SQL before execution',async()=>{
  const commands=new Map(),stored=new Map(),passwords=new Map(),calls=[],errors=[],documents=[];
  let trusted=true,confirm='Execute SQL',cancelInput=false;
  const inputs=['Fixture connection','db.example.test','5432','reader','app','','TEST_ONLY_DB_PASSWORD'];
  const v={ProgressLocation:{Notification:1},commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return {dispose(){}};}},
    workspace:{get isTrusted(){return trusted;},openTextDocument:async value=>{documents.push(value);return value;}},
    window:{activeTextEditor:{document:{languageId:'sql',getText:()=> 'DELETE FROM t'},selection:{isEmpty:true}},showTextDocument:async()=>{},
      showInputBox:async()=>cancelInput?undefined:inputs.shift(),withProgress:async(_,fn)=>fn(),
      showInformationMessage:async()=>{},showWarningMessage:async()=>confirm,showErrorMessage:async message=>errors.push(message),
      showQuickPick:async items=>typeof items[0]==='string'?(items.includes('postgres')?'postgres':items[0]):items[0]}};
  const context={subscriptions:[],globalState:{get:(key,fallback)=>stored.get(key)||fallback,update:async(k,val)=>stored.set(k,val)},secrets:{get:async k=>passwords.get(k),store:async(k,val)=>passwords.set(k,val),delete:async k=>passwords.delete(k)}};
  const original=Module._load;
  try {
    Module._load=function(id,...rest){if(id==='../../build/sftp/database')return {connection:require('../src/logic/database').connection,run:async(...args)=>{calls.push(args);return {columns:['name'],rows:[['app']],truncated:false};}};return original.call(this,id,...rest);};
    const file=require.resolve('../src/interface/database-extension');delete require.cache[file];require(file).activateDatabase(v,context);
    await commands.get('devkit.database.add')();assert.equal(passwords.size,1);assert.equal(JSON.stringify([...stored]).includes('TEST_ONLY_DB_PASSWORD'),false);assert.equal(calls[0][2],'test');
    confirm=undefined;const before=calls.filter(c=>c[2]==='query').length;await commands.get('devkit.database.query')();assert.equal(calls.filter(c=>c[2]==='query').length,before);
    confirm='Execute SQL';await commands.get('devkit.database.query')();assert.equal(calls.at(-1)[2],'query');assert.equal(calls.at(-1)[3].confirmed,true);assert.equal(calls.at(-1)[1],'TEST_ONLY_DB_PASSWORD');
    cancelInput=true;await commands.get('devkit.database.add')();assert.equal(passwords.size,1);
    trusted=false;const count=calls.length;await commands.get('devkit.database.test')();assert.equal(calls.length,count);assert.match(errors.at(-1),/Trust/);
    trusted=true;confirm='Remove connection';await commands.get('devkit.database.remove')();assert.equal(passwords.size,0);assert.deepEqual([...stored.values()][0],[]);
  } finally {Module._load=original;}
});
