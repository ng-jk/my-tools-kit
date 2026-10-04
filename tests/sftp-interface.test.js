'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {URI}=require('vscode-uri');
test('bundled SFTP registers upstream commands and toolkit sidebar in a host adapter',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-host-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.vscode'));fs.mkdirSync(path.join(root,'remote'));
  fs.writeFileSync(path.join(root,'ui.txt'),'uploaded from the UI adapter');
  fs.writeFileSync(path.join(root,'.vscode','sftp.json'),JSON.stringify({name:'fixture',protocol:'local',host:'fixture',username:'fixture',remotePath:path.join(root,'remote').replaceAll('\\','/')}));
  const commands=new Map(),views=new Map(),errors=[];const disposable=()=>({dispose(){}});
  const vscode={Uri:URI,StatusBarAlignment:{Left:1},TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},
    EventEmitter:class{event=()=>disposable();fire(){}dispose(){}},ThemeIcon:class{constructor(id){this.id=id;}},
    workspace:{isTrusted:true,asRelativePath:value=>path.relative(root,value),workspaceFolders:[{uri:URI.file(root)}],textDocuments:[],getConfiguration:()=>({get:()=>undefined}),
      onDidSaveTextDocument:disposable,onDidOpenTextDocument:disposable,registerTextDocumentContentProvider:disposable},
    commands:{registerCommand:(id,fn,self)=>{assert.equal(commands.has(id),false,'duplicate '+id);commands.set(id,fn.bind(self));return disposable();},executeCommand:async()=>{}},
    window:{activeTextEditor:{document:{uri:URI.file(path.join(root,'ui.txt'))}},createStatusBarItem:()=>({show(){},hide(){},dispose(){}}),createOutputChannel:()=>({appendLine(){},show(){},hide(){},dispose(){}}),
      showErrorMessage:async message=>{errors.push(message);},registerTreeDataProvider:(id,provider)=>{views.set(id,provider);return disposable();},
      createTreeView:(id,options)=>{views.set(id,options.treeDataProvider);return {selection:[],reveal:async()=>{},dispose(){}}}}
  };
  const original=Module._load;let extension;
  const context={subscriptions:[],extension:{packageJSON:require('../package.json')}};
  try {
    Module._load=function(id,...args){return id==='vscode'?vscode:original.call(this,id,...args);};
    extension=require('../build/sftp/extension');
    require('../src/interface/sidebar').activateSidebar(vscode,context);
    await extension.activate(context);
    assert.deepEqual(errors,[]);
    for(const entry of require('../vendor/sftp/package.json').contributes.commands)assert.ok(commands.has('devkit.'+entry.command),entry.command);
    assert.ok(views.has('devkit.remoteExplorer'));
    assert.deepEqual(views.get('devkit.tools').getChildren().map(item=>item.label),['API Debugger','JSON Formatter','Compare Text / Files','Compare Git Revisions','SFTP / FTP','CI/CD Pipeline']);
    assert.equal((await views.get('devkit.remoteExplorer').getChildren()).length,1);
    await commands.get('devkit.sftp.upload.activeFile')();
    assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(root,'remote','ui.txt'),'utf8'),'uploaded from the UI adapter');
  } finally {extension?.deactivate();context.subscriptions.forEach(item=>item.dispose());Module._load=original;}
});
