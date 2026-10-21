'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { activateTextTools } = require('../lib/text-extension');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const gitLogic=require('../src/logic/git-compare');
function fixture(t) {
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-git-selection-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  const root=path.join(parent,'project with spaces');fs.mkdirSync(root);
  const git=(args,cwd=root)=>execFileSync('git',['-c','safe.directory='+cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd,windowsHide:true,stdio:'pipe',env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)))});
  git(['init']);fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src','file.txt'),'before');git(['add','.']);git(['commit','-m','initial']);fs.writeFileSync(path.join(root,'src','file.txt'),'after');
  return {parent,root,git};
}
async function panel(selected,scmRoots=[]) {
  const commands=new Map(),messages=[],diffs=[];let receive;
  const uri=value=>({fsPath:value,toString:()=>value});
  const vscode={ViewColumn:{One:1},Uri:{joinPath:(base,...parts)=>uri(path.join(base.fsPath,...parts)),from:value=>({...value,toString:()=>value.scheme+':'+value.path})},
    workspace:{isTrusted:true,workspaceFolders:[],registerTextDocumentContentProvider:()=>({}),onDidCloseTextDocument:()=>({})},
    extensions:{getExtension:()=>({isActive:true,exports:{getAPI:()=>({repositories:scmRoots.map(root=>({rootUri:uri(root)}))})}})},
    commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return {};},executeCommand:async(...args)=>diffs.push(args)},
    window:{showOpenDialog:async()=>[uri(selected)],showQuickPick:async choices=>choices.find(c=>c.root)||choices[0],showErrorMessage:message=>messages.push({type:'error',text:message}),
      createWebviewPanel:()=>({webview:{cspSource:'fixture:',asWebviewUri:u=>u,onDidReceiveMessage:fn=>receive=fn,postMessage:async message=>messages.push(message)}})}};
  const root=path.resolve(__dirname,'..');activateTextTools(vscode,{subscriptions:[],extensionPath:root,extensionUri:uri(root)});
  await commands.get('devkit.compareGit')();return {vscode,messages,diffs,send:message=>receive(message)};
}

test('Git repository selection crosses the real data/logic/host bridge and opens a changed-file diff',async t=>{
  const {parent,root}=fixture(t);
  for(const selected of [root,path.join(root,'src'),path.join(root,'.git'),parent]) {
    const ui=await panel(selected);await ui.send({type:'repository'});
    const chosen=ui.messages.filter(m=>m.type==='repository').at(-1);assert.ok(chosen,JSON.stringify(ui.messages));assert.equal(path.resolve(chosen.root),path.resolve(root));assert.equal(chosen.commits.length,1);
    await ui.send({type:'changes',left:'HEAD',right:'WORKTREE'});assert.equal(ui.messages.find(m=>m.type==='changes').files[0].rightPath,'src/file.txt');
    await ui.send({type:'gitFile',index:0});assert.equal(ui.diffs[0][0],'vscode.diff');
  }
});
test('Git selection uses actual Source Control roots and supports linked worktrees',async t=>{
  const {parent,root,git}=fixture(t),worktree=path.join(parent,'linked');git(['worktree','add','--detach',worktree,'HEAD']);
  t.after(()=>{try{git(['worktree','remove','--force',worktree]);}catch{}});
  const ui=await panel(parent,[worktree]);await ui.send({type:'repository'});assert.equal(path.resolve(ui.messages.filter(m=>m.type==='repository').at(-1).root),path.resolve(worktree));
});
test('Invalid folder selection explains the selected path and keeps the previous repository',async t=>{
  const {parent,root}=fixture(t),invalid=path.join(parent,'downloaded zip');fs.mkdirSync(invalid);
  const ui=await panel(root);await ui.send({type:'repository'});const selected=ui.messages.filter(m=>m.type==='repository').at(-1).root;
  ui.vscode.window.showOpenDialog=async()=>[{fsPath:invalid}];await ui.send({type:'repository'});
  assert.equal(ui.messages.filter(m=>m.type==='repository').at(-1).root,selected);assert.ok(ui.messages.some(m=>m.type==='error'&&m.text.includes(invalid)&&m.text.includes('No Git working tree')));assert.equal(fs.existsSync(path.join(invalid,'.git')),false);
});
test('Unborn repositories and history failures do not hide a validated selection',async t=>{
  const {parent,root,git}=fixture(t),empty=path.join(parent,'empty');fs.mkdirSync(empty);git(['init'],empty);
  const ui=await panel(empty);await ui.send({type:'repository'});assert.equal(ui.messages.filter(m=>m.type==='repository').at(-1).commits.length,0);assert.ok(ui.messages.some(m=>m.text?.includes('no commits yet')));
  const original=gitLogic.history;gitLogic.history=async()=>{throw new Error('synthetic history failure');};
  try {const selected=await panel(root);await selected.send({type:'repository'});assert.ok(selected.messages.some(m=>m.type==='repository'&&path.resolve(m.root)===path.resolve(root)));assert.ok(selected.messages.some(m=>m.type==='error'&&m.text.includes('Commit history could not be loaded')));}
  finally {gitLogic.history=original;}
});
test('Git data adapter isolates comparisons from inherited Git context variables',async t=>{
  const {parent,root}=fixture(t),previous={GIT_DIR:process.env.GIT_DIR,GIT_WORK_TREE:process.env.GIT_WORK_TREE,GIT_CEILING_DIRECTORIES:process.env.GIT_CEILING_DIRECTORIES};
  try {
    process.env.GIT_DIR=path.join(parent,'not-a-repository');process.env.GIT_WORK_TREE=parent;process.env.GIT_CEILING_DIRECTORIES=root;
    assert.equal(path.resolve(await gitLogic.repository(path.join(root,'src'))),path.resolve(root));
    assert.equal((await gitLogic.changes(root,'HEAD','WORKTREE')).files[0].rightPath,'src/file.txt');
  }finally {for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('diff snapshots preserve empty sides, support long text, normalize explicitly, and release on close', async () => {
  let provider, close; const calls = [];
  const vscode = {
    workspace: { registerTextDocumentContentProvider: (scheme, p) => { provider = p; return {}; }, onDidCloseTextDocument: fn => { close = fn; return {}; } },
    commands: { registerCommand: () => ({}), executeCommand: async (...args) => calls.push(args) },
    Uri: { from: value => ({ ...value, toString: () => value.scheme + ':' + value.path }) }, window: {}
  };
  const tools = activateTextTools(vscode, { subscriptions: [] });
  await tools.showDiff('', 'new', 'left', 'right');
  assert.equal(calls[0][0], 'vscode.diff'); assert.equal(provider.provideTextDocumentContent(calls[0][1]), '');
  assert.equal(provider.provideTextDocumentContent(calls[0][2]), 'new');
  const long = '0123456789\n'.repeat(100000);
  await tools.showDiff(long, long + 'changed', 'original', 'modified');
  assert.equal(provider.provideTextDocumentContent(calls[1][1]), long);
  assert.equal(await tools.showDiff(' A \r\n', 'a\n', 'A', 'B', { trimWhitespace: true, ignoreCase: true }), true);
  close({ uri: calls[0][1] }); assert.match(provider.provideTextDocumentContent(calls[0][1]), /expired/);
});
