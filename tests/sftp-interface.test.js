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
  const statusTexts=[];
  let savedDocument, changedFolders, openedDocument; const contextValues=new Map(),commands=new Map(),views=new Map(),errors=[],watchers=[];const disposable=()=>({dispose(){}});
  const repository={rootUri:URI.file(root),ui:{selected:true},state:{indexChanges:[],workingTreeChanges:[]}};
  const repositories=[repository];
  const vscode={WorkspaceEdit:class{replace(uri,range,text){this.text=text;}},Range:class{},Uri:URI,StatusBarAlignment:{Left:1},TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},
    EventEmitter:class{event=()=>disposable();fire(){}dispose(){}},ThemeIcon:class{constructor(id){this.id=id;}},RelativePattern:class{},
    extensions:{getExtension:()=>({exports:{getAPI:()=>({repositories})}})},
    workspace:{onDidChangeWorkspaceFolders:fn=>{changedFolders=fn;return disposable();},isTrusted:true,asRelativePath:value=>path.relative(root,value),workspaceFolders:[{uri:URI.file(root)}],textDocuments:[],getConfiguration:()=>({get:()=>undefined}),
      createFileSystemWatcher:()=>{const watcher={disposed:false,handlers:{},onDidCreate(fn){this.handlers.create=fn;return disposable();},onDidChange(fn){this.handlers.change=fn;return disposable();},onDidDelete(fn){this.handlers.delete=fn;return disposable();},dispose(){this.disposed=true;}};watchers.push(watcher);return watcher;},
      onDidSaveTextDocument:fn=>{savedDocument=fn;return disposable();},onDidOpenTextDocument:fn=>{openedDocument=fn;return disposable();},registerTextDocumentContentProvider:disposable},
    commands:{registerCommand:(id,fn,self)=>{assert.equal(commands.has(id),false,'duplicate '+id);commands.set(id,fn.bind(self));return disposable();},executeCommand:async(id,...args)=>id==='setContext'?contextValues.set(args[0],args[1]):commands.has(id)?commands.get(id)(...args):undefined},
    window:{activeTextEditor:{document:{uri:URI.file(path.join(root,'ui.txt'))}},createStatusBarItem:()=>({set text(value){this.value=value;statusTexts.push(value);},get text(){return this.value;},show(){},hide(){},dispose(){}}),createOutputChannel:()=>({appendLine(){},show(){},hide(){},dispose(){}}),
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
    const addedRoot=path.join(dir,'added-workspace');fs.mkdirSync(path.join(addedRoot,'.vscode'),{recursive:true});
    fs.writeFileSync(path.join(addedRoot,'.vscode','sftp.json'),JSON.stringify({name:'added',protocol:'local',host:'fixture',username:'fixture',remotePath:path.join(dir,'remote-other').replaceAll('\\','/')}));
    await changedFolders({added:[{uri:URI.file(addedRoot)}],removed:[]});
    assert.equal((await views.get('devkit.remoteExplorer').getChildren()).length,2);
    await changedFolders({added:[],removed:[{uri:URI.file(addedRoot)}]});
    assert.equal((await views.get('devkit.remoteExplorer').getChildren()).length,1);

    await commands.get('devkit.sftp.upload.activeFile')();
    assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(dir,'remote','ui.txt'),'utf8'),'uploaded from the UI adapter');
    assert.ok(statusTexts.some(text=>text.includes('$(sync~spin)')));assert.ok(statusTexts.some(text=>text.includes('Uploading ui.txt')));
    await commands.get('devkit.sftp.menu')();
    assert.deepEqual(errors,[]);
    vscode.window.activeTextEditor=undefined;
    await commands.get('devkit.sftp.menu')();
    assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(dir,'remote','ui.txt'),'utf8'),'uploaded from the UI adapter');
    vscode.window.activeTextEditor={document:{uri:URI.file(path.join(root,'ui.txt'))}};
    await commands.get('devkit.sftp.download.file')();
    assert.deepEqual(errors,[]);assert.ok(statusTexts.some(text=>text.includes('Downloading ui.txt')));
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
    const nestedRepository={rootUri:URI.file(path.join(root,'nested')),ui:{selected:false},state:{indexChanges:[{status:0,uri:URI.file(path.join(root,'nested','ui.txt'))}],workingTreeChanges:[]}};
    repositories.push(nestedRepository);
    fs.writeFileSync(path.join(root,'ui.txt'),'must not upload selected repository');
    fs.writeFileSync(path.join(root,'nested','ui.txt'),'clicked repository content');
    await commands.get('devkit.sftp.upload.changedFiles')({rootUri:nestedRepository.rootUri});
    assert.equal(fs.readFileSync(path.join(dir,'remote','nested','ui.txt'),'utf8'),'clicked repository content');
    assert.equal(fs.readFileSync(path.join(dir,'remote','ui.txt'),'utf8'),'changed upload has completed');
    fs.writeFileSync(path.join(root,'nested','ui.txt'),'resource group content');
    await commands.get('devkit.sftp.upload.changedFiles')({id:'index',resourceStates:[{resourceUri:URI.file(path.join(root,'nested','ui.txt'))}]});
    assert.equal(fs.readFileSync(path.join(dir,'remote','nested','ui.txt'),'utf8'),'resource group content');
    assert.equal(fs.readFileSync(path.join(dir,'remote','ui.txt'),'utf8'),'changed upload has completed');
    repositories.pop();
    fs.writeFileSync(path.join(root,'nested','ui.txt'),'from other context');
    const cp=require('node:child_process');
    cp.execFileSync('git',['init',root],{stdio:'ignore'});
    cp.execFileSync('git',['-C',root,'add','ui.txt'],{stdio:'ignore'});
    cp.execFileSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture'],{stdio:'ignore'});
    cp.execFileSync('git',['-C',root,'clean','-nd'],{stdio:'ignore'});
    // Isolate tracked changes; ignored credentials must be counted as skipped.
    fs.writeFileSync(path.join(root,'.git','info','exclude'),'*\n!ui.txt\n!.env\n');
    fs.writeFileSync(path.join(root,'ui.txt'),'included change');
    fs.writeFileSync(path.join(root,'.env'),'private');
    fs.appendFileSync(path.join(root,'.git','info','exclude'),'!batch-second.txt\n');fs.writeFileSync(path.join(root,'batch-second.txt'),'second selected');
    const batchRoot=(await views.get('devkit.remoteExplorer').getChildren())[0];
    const batchFs=await batchRoot.explorerContext.fileService.getRemoteFileSystem(batchRoot.explorerContext.config);
    const batchPut=batchFs.put;let activeBatch=0,peakBatch=0;
    batchFs.put=async function(...args){activeBatch++;peakBatch=Math.max(peakBatch,activeBatch);try{await new Promise(resolve=>setTimeout(resolve,20));return await batchPut.apply(this,args);}finally{activeBatch--;}};
    const resultMessages=[];const previousInfo=vscode.window.showInformationMessage;
    vscode.window.showInformationMessage=async message=>{resultMessages.push(message);};
    try{await commands.get('devkit.sftp.upload.fileChanged')();}finally{batchFs.put=batchPut;}
    assert.equal(peakBatch,1,'changed-file batch bounds concurrent transfers');
    vscode.window.showInformationMessage=previousInfo;
    assert.ok(resultMessages.some(message=>/uploaded 2 file\(s\), skipped 1/.test(message)),JSON.stringify(resultMessages));
    assert.equal(fs.existsSync(path.join(dir,'remote','.env')),false);
    assert.equal(fs.readFileSync(path.join(dir,'remote','ui.txt'),'utf8'),'included change');
    fs.writeFileSync(path.join(dir,'remote','missing.txt'),'staged then deleted locally');
    repository.state.indexChanges=[{status:0,uri:URI.file(path.join(root,'missing.txt'))}];
    repository.state.workingTreeChanges=[{status:6,uri:URI.file(path.join(root,'missing.txt'))}];
    const confirmChanges=vscode.window.showInformationMessage;
    vscode.window.showInformationMessage=async message=>{assert.match(message,/remote deletions/);assert.match(message,/missing.txt/);return undefined;};
    await commands.get('devkit.sftp.upload.changedFiles')();
    assert.equal(fs.existsSync(path.join(dir,'remote','missing.txt')),true,'cancelled Git deletion preserves remote file');
    vscode.window.showInformationMessage=confirmChanges;
    await commands.get('devkit.sftp.upload.changedFiles')();
    assert.deepEqual(errors,[]);
    assert.equal(fs.existsSync(path.join(dir,'remote','missing.txt')),false,'staged modification followed by deletion removes the remote file');
    repository.state.workingTreeChanges=[];
    errors.length=0;
    await commands.get('devkit.sftp.upload.activeFile.to.allProfiles')();
    assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','ui.txt'),'utf8'),'from other context');
    const remoteRoot=(await views.get('devkit.remoteExplorer').getChildren())[0];
    const remoteSelection=(await views.get('devkit.remoteExplorer').getChildren(remoteRoot)).find(item=>path.basename(item.resource.fsPath)==='ui.txt');
    assert.ok(remoteSelection);
    const progressFs=await remoteRoot.explorerContext.fileService.getRemoteFileSystem(remoteRoot.explorerContext.config);
    const originalPut=progressFs.put;let resumeSlow,startedSlow;const slowStarted=new Promise(resolve=>startedSlow=resolve),slowReady=new Promise(resolve=>resumeSlow=resolve);
    fs.writeFileSync(path.join(root,'slow.txt'),'slow payload');
    progressFs.put=async function(input,target,...args){if(target.includes('slow.txt')){startedSlow();await slowReady;}return originalPut.call(this,input,target,...args);};
    const slowUpload=commands.get('devkit.sftp.upload.file')(URI.file(path.join(root,'slow.txt')));
    try {
      await slowStarted;
      await commands.get('devkit.sftp.upload.file')(URI.file(path.join(root,'ui.txt')));
      assert.match(statusTexts.at(-1),/sync~spin.*1 operation\(s\) running/);
    } finally {resumeSlow();await slowUpload;progressFs.put=originalPut;}
    assert.equal(statusTexts.at(-1).includes('sync~spin'),false);

    await commands.get('devkit.sftp.upload.file.to.allProfiles')(remoteSelection);
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
    const confirmSync=vscode.window.showInformationMessage;
    vscode.window.showInformationMessage=async message=>{assert.match(message,/delete destination-only/);assert.match(message,/remote-other/);return undefined;};
    await commands.get('devkit.sftp.sync.localToRemote')([path.join(root,'nested')]);
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','keep-on-cancel.txt'),'utf8'),'keep','cancelled sync makes no deletion');
    vscode.window.showInformationMessage=confirmSync;

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
    vscode.window.showQuickPick=async choices=>choices.find(item=>item.service?.name==='first') || choices[0];
    await commands.get('devkit.sftp.setProfile')('prod');assert.deepEqual(errors,[]);
    const selectedProfiles=await views.get('devkit.remoteExplorer').getChildren();
    assert.equal(selectedProfiles.find(item=>item.explorerContext.fileService.name==='first').explorerContext.fileService.profile,'prod');
    assert.equal(selectedProfiles.find(item=>item.explorerContext.fileService.name==='second').explorerContext.fileService.profile,'prod');
    await commands.get('devkit.sftp.setProfile')('dev');assert.deepEqual(errors,[]);
    const restoredProfiles=await views.get('devkit.remoteExplorer').getChildren();
    assert.equal(restoredProfiles.find(item=>item.explorerContext.fileService.name==='first').explorerContext.fileService.profile,'dev');
    assert.equal(restoredProfiles.find(item=>item.explorerContext.fileService.name==='second').explorerContext.fileService.profile,'prod','unrelated profile remains selected');


    extension.deactivate();commands.clear();views.clear();errors.length=0;
    const contextFile=path.join(root,'.vscode','sftp.json');
    const isolated={activeContext:'alpha',contexts:{alpha:{protocol:'local',host:'alpha-host',username:'alice',password:'alpha-secret',context:'.',remotePath:path.join(dir,'remote').replaceAll('\\','/'),watcher:{files:'**/*',autoUpload:true}},beta:{protocol:'local',host:'beta-host',username:'bob',password:'beta-secret',context:'.',remotePath:path.join(dir,'remote-other').replaceAll('\\','/')}}};
    fs.writeFileSync(contextFile,JSON.stringify(isolated));
    await extension.activate(context);
    let roots=await views.get('devkit.remoteExplorer').getChildren();assert.equal(roots.length,1);assert.equal(roots[0].explorerContext.config.host,'alpha-host');
    const alphaWatcher=watchers.at(-1);
    let documentText=fs.readFileSync(contextFile,'utf8');
    const document={uri:URI.file(contextFile),isDirty:false,getText:()=>documentText,positionAt:n=>n,save:async()=>{fs.writeFileSync(contextFile,documentText);await savedDocument(document);return true;}};
    vscode.workspace.openTextDocument=async()=>document;
    vscode.workspace.getWorkspaceFolder=()=>({uri:URI.file(root)});
    vscode.workspace.applyEdit=async edit=>{documentText=edit.text;return true;};
    vscode.window.showQuickPick=async choices=>choices.find(item=>item.name==='beta');
    await commands.get('devkit.sftp.selectContext')();assert.deepEqual(errors,[]);
    assert.equal(alphaWatcher.disposed,true);
    roots=await views.get('devkit.remoteExplorer').getChildren();assert.equal(roots.length,1);assert.equal(roots[0].explorerContext.config.host,'beta-host');assert.equal(roots[0].explorerContext.config.password,'beta-secret');
    assert.deepEqual(JSON.parse(documentText).contexts,isolated.contexts,'switching must preserve both independent configurations');
    fs.writeFileSync(path.join(root,'context-switch.txt'),'only beta');
    await commands.get('devkit.sftp.upload.file')(URI.file(path.join(root,'context-switch.txt')));assert.deepEqual(errors,[]);
    assert.equal(fs.existsSync(path.join(dir,'remote','context-switch.txt')),false);assert.equal(fs.readFileSync(path.join(dir,'remote-other','context-switch.txt'),'utf8'),'only beta');
    const betaRoot=roots[0];
    const provider=views.get('devkit.remoteExplorer'),changingPath=path.join(dir,'remote-other','changing-type');
    fs.writeFileSync(changingPath,'file');
    let changing=(await provider.getChildren(betaRoot)).find(item=>path.basename(item.resource.fsPath)==='changing-type');
    assert.equal(provider.getTreeItem(changing).contextValue,'file');
    fs.unlinkSync(changingPath);fs.mkdirSync(changingPath);
    await provider.refresh(betaRoot);
    changing=(await provider.getChildren(betaRoot)).find(item=>path.basename(item.resource.fsPath)==='changing-type');
    assert.equal(provider.getTreeItem(changing).contextValue,'folder');assert.equal(provider.getTreeItem(changing).command,undefined);
    assert.equal(provider.getTreeItem(changing).collapsibleState,vscode.TreeItemCollapsibleState.Collapsed);
    fs.rmdirSync(changingPath);fs.writeFileSync(changingPath,'file again');
    await provider.refresh(betaRoot);
    changing=(await provider.getChildren(betaRoot)).find(item=>path.basename(item.resource.fsPath)==='changing-type');
    assert.equal(provider.getTreeItem(changing).contextValue,'file');assert.ok(provider.getTreeItem(changing).command);
    assert.equal(provider.getTreeItem(changing).collapsibleState,undefined);

    vscode.window.showInputBox=async options=>{assert.ok(options.validateInput('../bad'));assert.equal(options.validateInput('created-remotely.txt'),undefined);return 'created-remotely.txt';};
    await commands.get('devkit.sftp.create.file')(betaRoot);assert.deepEqual(errors,[]);
    assert.equal(fs.existsSync(path.join(dir,'remote-other','created-remotely.txt')),true);
    vscode.window.showInputBox=async()=> 'created-folder';
    await commands.get('devkit.sftp.create.folder')(betaRoot);assert.deepEqual(errors,[]);
    assert.equal(fs.statSync(path.join(dir,'remote-other','created-folder')).isDirectory(),true);
    let retryInput=0;
    const errorDisplay=vscode.window.showErrorMessage;
    vscode.window.showErrorMessage=async()=> 'Retry';
    vscode.window.showInputBox=async options=>{if(retryInput++===0)return 'created-remotely.txt';assert.equal(options.value,'created-remotely.txt');return 'retried-name.txt';};
    await commands.get('devkit.sftp.create.file')(betaRoot);vscode.window.showErrorMessage=errorDisplay;
    assert.equal(fs.existsSync(path.join(dir,'remote-other','retried-name.txt')),true);
    fs.writeFileSync(path.join(dir,'remote-other','preview.txt'),'remote preview');
    const previewPicks=['beta','preview.txt'];
    vscode.window.showQuickPick=async choices=>{const label=previewPicks.shift();const item=choices.find(c=>c.label===label);assert.ok(item,'Missing '+label);return item;};
    let preview;
    vscode.window.showTextDocument=async uri=>{preview=await views.get('devkit.remoteExplorer').provideTextDocumentContent(uri,{});};
    await commands.get('devkit.sftp.viewContent')();assert.equal(preview,'remote preview');
    const permanentConfirm=vscode.window.showInformationMessage;
    vscode.window.showInformationMessage=async message=>{assert.match(message,/beta-host/);assert.match(message,/preview.txt/);assert.match(message,/cannot be undone/);return undefined;};
    const previewItem=(await views.get('devkit.remoteExplorer').getChildren(betaRoot)).find(item=>path.basename(item.resource.fsPath)==='preview.txt');
    await commands.get('devkit.sftp.delete.remote')(previewItem);
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','preview.txt'),'utf8'),'remote preview');
    vscode.window.showInformationMessage=permanentConfirm;
    const previewUri=previewItem.resource.uri.with({path:'/~ preview.txt'});
    vscode.window.activeTextEditor={document:{uri:previewUri}};
    vscode.window.showQuickPick=async choices=>choices.find(item=>item.label==='preview.txt');
    await commands.get('devkit.sftp.listActiveFolder')();assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(root,'preview.txt'),'utf8'),'remote preview');
    vscode.window.activeTextEditor={document:{uri:previewUri}};
    await commands.get('devkit.sftp.download.activeFolder')();assert.deepEqual(errors,[]);


    vscode.window.showQuickPick=async()=>undefined;
    const before=documentText;await commands.get('devkit.sftp.selectContext')();assert.equal(documentText,before,'cancel preserves context');

    extension.deactivate();commands.clear();views.clear();errors.length=0;
    const nestedA=path.join(dir,'remote','nested');fs.mkdirSync(nestedA,{recursive:true});
    fs.writeFileSync(path.join(nestedA,'wrong-server.txt'),'delete only A');fs.writeFileSync(path.join(dir,'remote-other','wrong-server.txt'),'preserve B');
    fs.writeFileSync(contextFile,JSON.stringify([
      {name:'Server A',uploadOnSave:true,downloadOnOpen:'confirm',watcher:{files:'**/*',autoUpload:true,autoDelete:true},context:'.',protocol:'local',host:'server-a',username:'alice',remotePath:path.join(dir,'remote').replaceAll('\\','/')},
      {name:'Server B',watcher:{files:false,autoUpload:false,autoDelete:false},context:'nested',protocol:'local',host:'server-b',username:'bob',remotePath:path.join(dir,'remote-other').replaceAll('\\','/')}
    ]));
    await extension.activate(context);

    const linkedFolder=path.join(root,'save-link');fs.symlinkSync(path.join(root,'nested'),linkedFolder,'junction');
    fs.writeFileSync(path.join(root,'nested','save-check.txt'),'must not transfer');
    await savedDocument({uri:URI.file(path.join(linkedFolder,'save-check.txt'))});
    assert.equal(fs.existsSync(path.join(dir,'remote-other','save-check.txt')),false);
    assert.equal(fs.existsSync(path.join(nestedA,'save-check.txt')),false);
    fs.rmdirSync(linkedFolder);
    fs.writeFileSync(path.join(root,'open-check.txt'),'keep local');
    const oldConfirm=vscode.window.showInformationMessage;let confirmOpen,promptOpen;
    const shown=new Promise(resolve=>promptOpen=resolve);
    vscode.window.showInformationMessage=async(message,...choices)=>{assert.match(message,/server-a/);assert.match(message,/open-check.txt/);assert.match(message,/overwrite/);promptOpen();return new Promise(resolve=>confirmOpen=()=>resolve(choices[0]));};
    const pendingOpen=openedDocument({uri:URI.file(path.join(root,'open-check.txt'))});
    await shown;
    await savedDocument({uri:URI.file(contextFile)});
    confirmOpen();await pendingOpen;
    vscode.window.showInformationMessage=oldConfirm;
    assert.equal(fs.readFileSync(path.join(root,'open-check.txt'),'utf8'),'keep local','stale download confirmation cannot overwrite after config replacement');
    const parentWatcher=watchers.filter(item=>!item.disposed).at(-1);
    fs.writeFileSync(path.join(root,'nested','automation.txt'),'local change');
    fs.writeFileSync(path.join(dir,'remote-other','automation.txt'),'preserve B');
    parentWatcher.handlers.change(URI.file(path.join(root,'nested','automation.txt')));
    await new Promise(resolve=>setTimeout(resolve,750));
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','automation.txt'),'utf8'),'preserve B');
    fs.unlinkSync(path.join(root,'nested','automation.txt'));
    parentWatcher.handlers.delete(URI.file(path.join(root,'nested','automation.txt')));
    await new Promise(resolve=>setTimeout(resolve,750));
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','automation.txt'),'utf8'),'preserve B');
    vscode.window.activeTextEditor=undefined;
    const picks=['Server A','nested/','wrong-server.txt'];
    vscode.window.showQuickPick=async choices=>{const label=picks.shift();const item=choices.find(c=>c.label===label);assert.ok(item,'Missing '+label);return item;};
    // Do not expand the explorer first: command routing must also work when its roots are lazy.
    await commands.get('devkit.sftp.delete.remote')();assert.deepEqual(errors,[]);assert.equal(picks.length,0);
    assert.equal(fs.existsSync(path.join(nestedA,'wrong-server.txt')),false,'delete targets the selected server despite nested local context');
    assert.equal(fs.readFileSync(path.join(dir,'remote-other','wrong-server.txt'),'utf8'),'preserve B');
    fs.writeFileSync(path.join(nestedA,'download-target.txt'),'from A');fs.writeFileSync(path.join(dir,'remote-other','download-target.txt'),'from B');
    fs.writeFileSync(path.join(root,'active.txt'),'local');
    vscode.window.activeTextEditor={document:{uri:URI.file(path.join(root,'active.txt'))}};
    const activePicks=['nested/','download-target.txt'];
    vscode.window.showQuickPick=async choices=>{const label=activePicks.shift();const item=choices.find(c=>c.label===label);assert.ok(item,'Missing '+label);return item;};
    await commands.get('devkit.sftp.listActiveFolder')();assert.deepEqual(errors,[]);
    assert.equal(fs.readFileSync(path.join(root,'nested','download-target.txt'),'utf8'),'from A');
    extension.deactivate();commands.clear();views.clear();errors.length=0;fs.unlinkSync(contextFile);
    await extension.activate(context);
    assert.equal(contextValues.get('devkit.sftp.hasConfiguration'),false);
    assert.equal((await views.get('devkit.remoteExplorer').getChildren()).length,0);
    assert.equal(require('../package.json').contributes.viewsWelcome[0].when,'!devkit.sftp.hasConfiguration');
    extension.deactivate();commands.clear();views.clear();errors.length=0;
    fs.writeFileSync(contextFile,'invalid json');await extension.activate(context);
    assert.ok(errors.length);assert.ok(views.has('devkit.remoteExplorer'));assert.ok(commands.has('devkit.sftp.viewContent'));
    errors.length=0;fs.writeFileSync(contextFile,JSON.stringify(isolated));
    await savedDocument({uri:URI.file(contextFile)});
    const recoveredRoots=await views.get('devkit.remoteExplorer').getChildren();assert.equal(recoveredRoots.length,1);assert.deepEqual(errors,[]);
    assert.equal(contextValues.get('devkit.sftp.hasConfiguration'),true);




  } finally {extension?.deactivate();context.subscriptions.forEach(item=>item.dispose());Module._load=original;fs.readdir=nativeReaddir;}
});

test('remote picker keeps server identity when browsing equal paths on different servers',async()=>{
  const {FileType}=require('../build/sftp/engine');
  const compiled=require('esbuild').buildSync({entryPoints:[path.resolve('src/interface/sftp/helper/select.ts')],bundle:true,write:false,platform:'node',target:'node20',format:'cjs',external:['vscode','*.node','cpu-features'],logLevel:'silent'}).outputFiles[0].text;
  for(const labels of [['Server A','..','Server B','file.txt'],['Server B','..','Server A','file.txt']]) {
    const selectedServer=labels[2],queue=[...labels],listed=[];
    const original=Module._load;const filename=path.resolve('tests/picker-fixture.js'),fixtureModule=new Module(filename,module);fixtureModule.filename=filename;fixtureModule.paths=module.paths;
    try {
      Module._load=function(id,...args){return id==='vscode'?{window:{showQuickPick:async items=>{const label=queue.shift();const selected=items.find(item=>item.label===label);assert.ok(selected,'Missing picker entry '+label);return selected;}}}:original.call(this,id,...args);};
      fixtureModule._compile(compiled,filename);
      const roots=['Server A','Server B'].map((name,index)=>({name,index,fsPath:'/srv/app',type:FileType.Directory,description:name,getFs:async()=>({list:async remotePath=>{listed.push(name);assert.equal(remotePath,'/srv/app');return [{fspath:'/srv/app/file.txt',type:FileType.File}];}})}));
      const selected=await fixtureModule.exports.listFiles(roots);
      assert.equal(selected.index,selectedServer==='Server A'?0:1);assert.equal(selected.description,'');assert.equal(selected.fsPath,'/srv/app/file.txt');
      assert.deepEqual(listed,[labels[0],selectedServer]);assert.equal(queue.length,0);
    } finally {Module._load=original;}
  }
});

test('remote tree transfer actions are scoped to the remote explorer',()=>{
  for(const item of require('../package.json').contributes.menus['view/item/context']) assert.ok(item.when.includes('view == devkit.remoteExplorer'),item.command);
});
