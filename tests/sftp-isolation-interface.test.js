'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runIsolationCheck}=require('../src/interface/sftp-isolation');
const {isolationConnection}=require('../build/sftp/engine');
function fixture(){
 let content,active=false,starts=0,shown=0;const notices=[];
 const vscode={ProgressLocation:{Notification:15},window:{showInformationMessage:message=>notices.push(message),showQuickPick:async choices=>choices[1],withProgress:async(_options,run)=>{active=true;starts++;try{return await run();}finally{active=false;}},showTextDocument:async()=>shown++},workspace:{openTextDocument:async options=>{content=options.content;return options;}}};
 return {vscode,notices,get active(){return active;},get content(){return content;},get starts(){return starts;},get shown(){return shown;}};
}
function record(workspace,host='same.invalid'){
 const config={host,port:22,remotePath:'/project',password:'must-not-appear'},service={workspace,baseDir:workspace+'/context',profile:'live',getRemoteFileSystem:async()=>({})};
 return {label:'Duplicate',service,config,connection:isolationConnection(service,config)};
}
const inspect=async(_fs,root,connection)=>({passed:true,root,connection,message:'Metadata only',jail:'not-verifiable-over-FTP-or-SFTP'});
test('isolation picker and report distinguish duplicate server names across workspace/context and host',async()=>{
 const f=fixture(),a=record('/workspace/a'),b=record('/workspace/b');let inspected;
 f.vscode.window.showQuickPick=async choices=>{assert.equal(choices[0].label,choices[1].label);assert.notEqual(choices[0].detail,choices[1].detail);assert.match(choices[1].description,/same.invalid:22.*live/);return choices[1];};
 await runIsolationCheck(f.vscode,[a,b],async(...args)=>{inspected=args[2];return inspect(...args);});
 assert.equal(inspected.workspace,'/workspace/b');assert.match(f.content,/Server: same.invalid:22/);assert.match(f.content,/Workspace: \/workspace\/b/);assert.match(f.content,/Context: \/workspace\/b\/context/);assert.ok(!f.content.includes('must-not-appear'));assert.equal(f.shown,1);
 const c=record('/workspace/b','other.invalid');assert.notDeepEqual(c.connection,b.connection);
});
test('isolation progress covers delayed connection acquisition and failure',async()=>{
 const f=fixture(),a=record('/workspace/a');let release;
 a.service.getRemoteFileSystem=async()=>{assert.equal(f.active,true);await new Promise(resolve=>release=resolve);return {};};
 const pending=runIsolationCheck(f.vscode,[a],inspect);assert.equal(f.starts,1);assert.equal(f.content,undefined);release();await pending;assert.equal(f.active,false);assert.equal(f.shown,1);
 a.service.getRemoteFileSystem=async()=>{assert.equal(f.active,true);throw new Error('connection failed');};await assert.rejects(runIsolationCheck(f.vscode,[a],inspect),/connection failed/);assert.equal(f.active,false);assert.equal(f.shown,1,'no misleading success document after connection failure');
});
test('isolation empty state and cancelled picker never connect',async()=>{
 const f=fixture();await runIsolationCheck(f.vscode,[],inspect);assert.deepEqual(f.notices,['Configure an FTP/SFTP connection first.']);
 const a=record('/a'),b=record('/b');a.service.getRemoteFileSystem=b.service.getRemoteFileSystem=async()=>{throw new Error('must not connect');};f.vscode.window.showQuickPick=async()=>undefined;await runIsolationCheck(f.vscode,[a,b],inspect);assert.equal(f.starts,0);assert.equal(f.shown,0);
});
