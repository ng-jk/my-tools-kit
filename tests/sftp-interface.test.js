'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {URI,Utils}=require('vscode-uri');
URI.joinPath=Utils.joinPath;
test('bundled SFTP registers upstream commands and toolkit sidebar in a host adapter',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-host-'));const root=path.join(dir,'local');fs.mkdirSync(root);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.vscode'));fs.mkdirSync(path.join(dir,'remote'));
  fs.mkdirSync(path.join(root,'nested'));fs.mkdirSync(path.join(dir,'remote-other'));
  fs.writeFileSync(path.join(root,'nested','ui.txt'),'from other context');
  fs.writeFileSync(path.join(root,'ui.txt'),'uploaded from the UI adapter');
  fs.writeFileSync(path.join(root,'.vscode','sftp.json'),JSON.stringify({name:'fixture',protocol:'local',host:'fixture',username:'fixture',remotePath:path.join(dir,'remote').replaceAll('\\','/'),syncOption:{delete:true},defaultProfile:'dev',profiles:{dev:{watcher:{files:'**/*',autoUpload:true,autoDelete:true}},prod:{watcher:{files:false}},other:{context:'nested',remotePath:path.join(dir,'remote-other').replaceAll('\\','/')}}}));
  const commands=new Map(),views=new Map(),errors=[],watchers=[];const disposable=()=>({dispose(){}});
  const repository={rootUri:URI.file(root),ui:{selected:true},state:{indexChanges:[],workingTreeChanges:[]}};
  const vscode={Uri:URI,StatusBarAlignment:{Left:1},TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},
    EventEmitter:class{event=()=>disposable();fire(){}dispose(){}},ThemeIcon:class{constructor(id){this.id=id;}},RelativePattern:class{},
    extensions:{getExtension:()=>({exports:{getAPI:()=>({repositories:[repository]})}})},
    workspace:{isTrusted:true,asRelativePath:value=>path.relative(root,value),workspaceFolders:[{uri:URI.file(root)}],textDocuments:[],getConfiguration:()=>({get:()=>undefined}),
      createFileSystemWatcher:()=>{const watcher={disposed:false,handlers:{},onDidCreate(fn){this.handlers.create=fn;return disposable();},onDidChange(fn){this.handlers.change=fn;return disposable();},onDidDelete(fn){this.handlers.delete=fn;return disposable();},dispose(){this.disposed=true;}};watchers.push(watcher);return watcher;},
      onDidSaveTextDocument:disposable,onDidOpenTextDocument:disposable,registerTextDocumentContentProvider:disposable},
    commands:{registerCommand:(id,fn,self)=>{assert.equal(commands.has(id),false,'duplicate '+id);commands.set(id,fn.bind(self));return disposable();},executeCommand:async(id,...args)=>commands.has(id)?commands.get(id)(...args):undefined},
    window:{activeTextEditor:{document:{uri:URI.file(path.join(root,'ui.txt'))}},createStatusBarItem:()=>({show(){},hide(){},dispose(){}}),createOutputChannel:()=>({appendLine(){},show(){},hide(){},dispose(){}}),
      showQuickPick:async choices=>choices.find(item=>item.command==='devkit.sftp.upload.file') || choices[0],
      showOpenDialog:async()=>[URI.file(path.join(root,'ui.txt'))],
      showInformationMessage:async(message,...choices)=>choices[0],showErrorMessage:async message=>{errors.push(message);},registerTreeDataProvider:(id,provider)=>{views.set(id,provider);return disposable();},
      createTreeView:(id,options)=>{views.set(id,options.treeDataProvider);return {selection:[],reveal:async()=>{},dispose(){}}}}
  };
  const original=Module._load;let extension;
  const nativeReaddir=fs.readdir;let readHook;
  fs.readdir=(...args)=>readHook?readHook(...args):nativeReaddir(...args);
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
    assert.equal(fs.readFileSync(path.join(dir,'remote','ui.txt'),'utf8'),'uploaded from the UI adapter');
    await commands.get('devkit.sftp.menu')();
    assert.deepEqual(errors,[]);
    vscode.window.activeTextEditor=undefined;
    await commands.get('devkit.sftp.menu')();
    assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(dir,'remote','ui.txt'),'utf8'),'uploaded from the UI adapter');
    vscode.window.activeTextEditor={document:{uri:URI.file(path.join(root,'ui.txt'))}};
    await commands.get('devkit.sftp.download.file')();
    assert.deepEqual(errors,[]);
    const originalDialog=vscode.window.showOpenDialog;vscode.window.activeTextEditor=undefined;vscode.window.showOpenDialog=async()=>undefined;
    await commands.get('devkit.sftp.upload.file')();assert.deepEqual(errors,[]);
    vscode.window.showOpenDialog=originalDialog;vscode.window.activeTextEditor={document:{uri:URI.file(path.join(root,'ui.txt'))}};
    const originalPick=vscode.window.showQuickPick;
    vscode.window.showQuickPick=async choices=>choices.find(item=>item.label==='.') || choices[0];
    await commands.get('devkit.sftp.download.folder')();assert.deepEqual(errors,[]);
    vscode.window.showQuickPick=originalPick;
    vscode.window.showInputBox=async()=> 'menu-created.txt';
    await commands.get('devkit.sftp.create.file')();assert.deepEqual(errors,[]);
    assert.equal(fs.existsSync(path.join(dir,'remote','menu-created.txt')),true);
    assert.equal(watchers.length,1);
    await commands.get('devkit.sftp.setProfile')('prod');
    assert.equal(watchers[0].disposed,true,'same-context profile switch disposes old watcher');
    assert.equal(watchers.length,1,'disabled profile creates no watcher');
    await views.get('devkit.remoteExplorer').getChildren();
    const oldUri=URI.file(path.join(root,'old.txt')),newUri=URI.file(path.join(root,'new.txt'));
    fs.writeFileSync(path.join(dir,'remote','old.txt'),'renamed remotely');
    fs.writeFileSync(newUri.fsPath,'renamed locally');
    repository.state.indexChanges=[{status:3,originalUri:oldUri,renameUri:newUri,uri:newUri}];
    await commands.get('devkit.sftp.upload.changedFiles')();
    assert.deepEqual(errors,[]);
    assert.equal(fs.existsSync(path.join(dir,'remote','old.txt')),false);
    assert.equal(fs.readFileSync(path.join(dir,'remote','new.txt'),'utf8'),'renamed locally');
    repository.state.indexChanges=[{status:0,uri:URI.file(path.join(root,'ui.txt'))}];
    fs.writeFileSync(path.join(root,'ui.txt'),'changed upload has completed');
    await commands.get('devkit.sftp.upload.changedFiles')();
    assert.equal(fs.readFileSync(path.join(dir,'remote','ui.txt'),'utf8'),'changed upload has completed');
    fs.writeFileSync(path.join(dir,'remote','missing.txt'),'staged then deleted locally');
    repository.state.indexChanges=[{status:0,uri:URI.file(path.join(root,'missing.txt'))}];
    repository.state.workingTreeChanges=[{status:6,uri:URI.file(path.join(root,'missing.txt'))}];
    await commands.get('devkit.sftp.upload.changedFiles')();
    assert.deepEqual(errors,[]);
    assert.equal(fs.existsSync(path.join(dir,'remote','missing.txt')),false,'staged modification followed by deletion removes the remote file');
    repository.state.workingTreeChanges=[];
    errors.length=0;
    await commands.get('devkit.sftp.upload.activeFile.to.allProfiles')();
    assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','ui.txt'),'utf8'),'from other context');
    fs.writeFileSync(path.join(root,'second.txt'),'second selection');
    fs.writeFileSync(path.join(root,'nested','second.txt'),'second profile selection');
    await commands.get('devkit.sftp.upload.file.to.allProfiles')(URI.file(path.join(root,'ui.txt')),[URI.file(path.join(root,'ui.txt')),URI.file(path.join(root,'second.txt'))]);
    assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(dir,'remote','second.txt'),'utf8'),'second selection');
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','second.txt'),'utf8'),'second profile selection');
    await commands.get('devkit.sftp.setProfile')('dev');await views.get('devkit.remoteExplorer').getChildren();
    const observer=watchers.at(-1);
    const native=fs.watch(root,{recursive:true},(_,name)=>{if(!name)return;const uri=URI.file(path.join(root,name));const handler=fs.existsSync(uri.fsPath)?observer.handlers.change:observer.handlers.delete;handler?.(uri);});
    try {
      fs.writeFileSync(path.join(dir,'remote','ui.txt'),'remote replacement');
      await commands.get('devkit.sftp.download.activeFile')();
      observer.handlers.delete(URI.file(path.join(root,'ui.txt'))); // delayed own rename event
      await new Promise(resolve=>setTimeout(resolve,850));
      assert.deepEqual(errors,[]);
      assert.equal(fs.readFileSync(path.join(dir,'remote','ui.txt'),'utf8'),'remote replacement');
      assert.equal(fs.readFileSync(path.join(root,'ui.txt'),'utf8'),'remote replacement');
      assert.equal(fs.readdirSync(path.join(dir,'remote')).some(name=>name.includes('.devkit-')),false);
      fs.unlinkSync(path.join(root,'ui.txt'));observer.handlers.delete(URI.file(path.join(root,'ui.txt')));
      await new Promise(resolve=>setTimeout(resolve,850));
      assert.equal(fs.existsSync(path.join(dir,'remote','ui.txt')),false,'a real user deletion still propagates');
    } finally {native.close();}
    fs.mkdirSync(path.join(dir,'remote','config'));fs.writeFileSync(path.join(dir,'remote','config','.env'),'server credential');fs.writeFileSync(path.join(dir,'remote','config','remove.txt'),'obsolete');
    observer.handlers.delete(URI.file(path.join(root,'config')));
    await new Promise(resolve=>setTimeout(resolve,850));
    assert.equal(fs.readFileSync(path.join(dir,'remote','config','.env'),'utf8'),'server credential');
    assert.equal(fs.existsSync(path.join(dir,'remote','config','remove.txt')),false);
    await commands.get('devkit.sftp.setProfile')('other');await views.get('devkit.remoteExplorer').getChildren();
    fs.mkdirSync(path.join(dir,'private'));fs.writeFileSync(path.join(dir,'private','secret.txt'),'unrelated remote content');
    const incoming=URI.file(path.join(root,'nested','incoming.txt'));
    fs.writeFileSync(incoming.fsPath,'moved into context');
    repository.state.indexChanges=[{status:3,originalUri:URI.file(path.join(root,'private','secret.txt')),renameUri:incoming,uri:incoming}];
    await commands.get('devkit.sftp.upload.changedFiles')();
    assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(dir,'private','secret.txt'),'utf8'),'unrelated remote content');
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','incoming.txt'),'utf8'),'moved into context');
    await commands.get('devkit.sftp.delete.remote')(incoming,[URI.file(path.join(root,'nested')),incoming]);
    assert.ok(errors.some(message=>/non-root/.test(message)),'mixed selection rejects remote root deletion');
    assert.equal(fs.existsSync(path.join(dir,'remote-other')),true);
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','ui.txt'),'utf8'),'from other context');

    errors.length=0;
    fs.writeFileSync(path.join(dir,'remote-other','keep-on-cancel.txt'),'keep');
    const originalRead=nativeReaddir;
    let cancellationCount=0;
    readHook=function(directory,callback){
      return originalRead.call(this,directory,(...args)=>{
        if (path.resolve(directory).toLowerCase()===path.join(root,'nested').toLowerCase()) {
          cancellationCount++;
          commands.get('devkit.sftp.cancelAllTransfer')().then(()=>callback(...args),callback);
        } else callback(...args);
      });
    };
    try {await commands.get('devkit.sftp.sync.localToRemote')([path.join(root,'nested')]);}
    finally {readHook=undefined;}
    assert.ok(cancellationCount>0,JSON.stringify(errors));
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','keep-on-cancel.txt'),'utf8'),'keep');
    assert.ok(errors.some(message=>/cancelled/.test(message)));
    errors.length=0;
    await commands.get('devkit.sftp.setProfile')('prod');await views.get('devkit.remoteExplorer').getChildren();
    fs.mkdirSync(path.join(root,'batch'));fs.writeFileSync(path.join(root,'batch','payload.txt'),'do not upload');
    fs.mkdirSync(path.join(root,'nested','batch'));fs.writeFileSync(path.join(root,'nested','batch','payload.txt'),'do not upload');
    let release;const blocked=new Promise(resolve=>release=resolve);
    const delayed=[];
    readHook=function(directory,callback){
      if (path.basename(directory)==='batch') {
        delayed.push(()=>originalRead.call(this,directory,callback));
        if(delayed.length===3)release();
        return;
      }
      return originalRead.call(this,directory,callback);
    };
    try {
      const uploading=commands.get('devkit.sftp.upload.folder.to.allProfiles')(URI.file(path.join(root,'batch')));
      await Promise.race([blocked,new Promise((_,reject)=>setTimeout(()=>reject(new Error('profile planning did not start')),2000))]);
      await commands.get('devkit.sftp.cancelAllTransfer')();
      delayed.forEach(resume=>resume());
      await uploading;
    } finally {readHook=undefined;}
    assert.equal(fs.existsSync(path.join(dir,'remote','batch','payload.txt')),false);
    assert.equal(fs.existsSync(path.join(dir,'remote-other','batch','payload.txt')),false);
    assert.ok(errors.some(message=>/cancelled/.test(message)));

    extension.deactivate();commands.clear();views.clear();errors.length=0;
    for(const name of ['first-dev','first-prod','second-dev','second-prod','dest-first-dev','dest-first-prod','dest-second-dev','dest-second-prod'])fs.mkdirSync(path.join(root,name));
    const configs=['first','second'].map((name,index)=>({name,protocol:'local',host:'fixture',username:'fixture',remotePath:path.join(root,'dest-'+name+'-dev').replaceAll('\\','/'),defaultProfile:index?'prod':'dev',profiles:{
      dev:{context:name+'-dev',remotePath:path.join(root,'dest-'+name+'-dev').replaceAll('\\','/'),watcher:{files:false}},
      prod:{context:name+'-prod',remotePath:path.join(root,'dest-'+name+'-prod').replaceAll('\\','/'),watcher:{files:false}}
    }}));
    fs.writeFileSync(path.join(root,'.vscode','sftp.json'),JSON.stringify(configs));
    fs.writeFileSync(path.join(root,'first-dev','profile.txt'),'first dev');fs.writeFileSync(path.join(root,'second-prod','profile.txt'),'second prod');
    await extension.activate(context);
    assert.equal((await views.get('devkit.remoteExplorer').getChildren()).length,2);
    await commands.get('devkit.sftp.upload.file')(URI.file(path.join(root,'first-dev','profile.txt')));
    await commands.get('devkit.sftp.upload.file')(URI.file(path.join(root,'second-prod','profile.txt')));
    assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(root,'dest-first-dev','profile.txt'),'utf8'),'first dev');
    assert.equal(fs.readFileSync(path.join(root,'dest-second-prod','profile.txt'),'utf8'),'second prod');
    assert.equal(fs.existsSync(path.join(root,'dest-first-prod','profile.txt')),false);
    assert.equal(fs.existsSync(path.join(root,'dest-second-dev','profile.txt')),false);

  } finally {extension?.deactivate();context.subscriptions.forEach(item=>item.dispose());Module._load=original;fs.readdir=nativeReaddir;}
});
