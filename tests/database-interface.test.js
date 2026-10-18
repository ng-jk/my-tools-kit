'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
test('database UI saves credentials only in secrets and cancels SQL before execution',async()=>{
  const commands=new Map(),stored=new Map(),passwords=new Map(),calls=[],errors=[],documents=[];
  let trusted=true,confirm='Execute SQL',cancelInput=false,responses=[];const validations=[];
  const inputs=['Fixture connection','db.example.test','5432','reader','app','','TEST_ONLY_DB_PASSWORD'];
  const v={ProgressLocation:{Notification:1},commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return {dispose(){}};}},
    workspace:{get isTrusted(){return trusted;},openTextDocument:async value=>{documents.push(value);return value;}},
    window:{activeTextEditor:{document:{languageId:'sql',getText:()=> 'DELETE FROM t'},selection:{isEmpty:true}},showTextDocument:async()=>{},
      showInputBox:async options=>{if(options.validateInput)validations.push(options);return cancelInput?undefined:inputs.shift();},withProgress:async(_,fn)=>fn(),
      showInformationMessage:async()=>{},showWarningMessage:async()=>confirm,showErrorMessage:async message=>errors.push(message),
      showQuickPick:async items=>typeof items[0]==='string'?(items.includes('postgres')?'postgres':items[0]):items[0]}};
  const context={subscriptions:[],globalState:{get:(key,fallback)=>stored.get(key)||fallback,update:async(k,val)=>stored.set(k,val)},secrets:{get:async k=>passwords.get(k),store:async(k,val)=>passwords.set(k,val),delete:async k=>passwords.delete(k)}};
  const original=Module._load;
  try {
    Module._load=function(id,...rest){if(id==='../../build/sftp/database')return {connection:require('../src/logic/database').connection,run:async(...args)=>{calls.push(args);return responses.length?responses.shift():{columns:['name'],rows:[['app']],truncated:false};}};return original.call(this,id,...rest);};
    const file=require.resolve('../src/interface/database-extension');delete require.cache[file];require(file).activateDatabase(v,context);
    await commands.get('devkit.database.add')();assert.equal(passwords.size,1);assert.equal(JSON.stringify([...stored]).includes('TEST_ONLY_DB_PASSWORD'),false);assert.equal(calls[0][2],'test');
    const port=validations.find(o=>o.prompt==='Database port');assert.ok(port.validateInput('invalid'));assert.ok(port.validateInput('0'));assert.equal(port.validateInput('5432'),undefined);
    assert.ok(validations.find(o=>o.prompt==='Database hostname or IP address').validateInput(''));
    assert.ok(validations.find(o=>o.prompt==='Database username').validateInput(''));
    confirm=undefined;const before=calls.filter(c=>c[2]==='query').length;await commands.get('devkit.database.query')();assert.equal(calls.filter(c=>c[2]==='query').length,before);
    confirm='Execute SQL';await commands.get('devkit.database.query')();assert.equal(calls.at(-1)[2],'query');assert.equal(calls.at(-1)[3].confirmed,true);assert.equal(calls.at(-1)[1],'TEST_ONLY_DB_PASSWORD');
    const oldId=[...passwords.keys()][0],savedWarning=v.window.showWarningMessage;let edited=false;
    const queryCount=calls.filter(c=>c[2]==='query').length;
    v.window.showWarningMessage=async message=>{
      if(!edited&&message.startsWith('Execute SQL on')){edited=true;inputs.push('Edited connection','new.example.test','5432','reader','app','','TEST_ONLY_REPLACEMENT_PASSWORD');await commands.get('devkit.database.edit')();}
      return 'Execute SQL';
    };
    await commands.get('devkit.database.query')();assert.equal(edited,true);assert.equal(calls.filter(c=>c[2]==='query').length,queryCount,'stale confirmation cannot connect with replacement credentials');assert.match(errors.at(-1),/connection changed/);assert.equal(passwords.has(oldId),false);assert.equal(passwords.size,1);
    v.window.showWarningMessage=savedWarning;
    const oldInput=v.window.showInputBox,oldWarning=v.window.showWarningMessage,oldPick=v.window.showQuickPick;
    const extraInput=['%last%','known_table'],choices=['Filter list','Enter exact name'];
    responses=[{rows:[['first']],truncated:true},{rows:[['last_database']],truncated:false},{rows:[['public']],truncated:false},{rows:[],truncated:false},{columns:['value'],rows:[[1]],truncated:false},{rows:[['table']],truncated:false}];
    v.window.showInputBox=async()=>extraInput.shift();v.window.showWarningMessage=async()=>choices.shift();
    v.window.showQuickPick=async(items,options)=>options?.title?.startsWith('Tables and views')?undefined:oldPick(items,options);
    await commands.get('devkit.database.browse')();
    assert.ok(calls.some(c=>c[2]==='databases'&&c[3].filter==='%last%'),'truncated metadata can be filtered on server');
    assert.ok(calls.some(c=>c[2]==='preview'&&c[3].table==='known_table'),'empty metadata supports exact-name browsing');
    v.window.showInputBox=oldInput;v.window.showWarningMessage=oldWarning;v.window.showQuickPick=oldPick;
    cancelInput=true;await commands.get('devkit.database.add')();assert.equal(passwords.size,1);
    const credential=[...passwords][0];passwords.clear();const beforeMissing=calls.length;await commands.get('devkit.database.test')();assert.equal(calls.length,beforeMissing);assert.match(errors.at(-1),/password is missing/);passwords.set(...credential);
    trusted=false;const count=calls.length;await commands.get('devkit.database.test')();assert.equal(calls.length,count);assert.match(errors.at(-1),/Trust/);
    trusted=true;confirm='Remove connection';await commands.get('devkit.database.remove')();assert.equal(passwords.size,0);assert.deepEqual([...stored.values()][0],[]);
  } finally {Module._load=original;}
});
