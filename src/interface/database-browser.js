'use strict';
const crypto=require('node:crypto');
const {connection}=require('../../build/sftp/database');
const ui=require('./database-workbench');
function activateBrowser(vscode,context,api) {
  const panels=new Map(),secret=id=>'devkit.database.password.'+id;
  let mutation=Promise.resolve();
  const changes=new vscode.EventEmitter(),overrides=new Map();
  const refresh=()=>{overrides.clear();changes.fire(undefined);};
  const live=p=>{api.trust();if(!api.profiles().some(x=>x.id===p.id))throw new Error('Database connection changed or was removed. Reopen it from the sidebar.');};
  const create=(id,title)=>{
    const panel=vscode.window.createWebviewPanel('devkit.database',title,vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
    panels.set(id,panel);panel.onDidDispose(()=>{for(const [key,value]of panels)if(value===panel)panels.delete(key);});context.subscriptions.push(panel);return panel;
  };
  const postResult=(panel,value)=>{if(value)panel.webview.postMessage({type:'result',value,summary:ui.summary(value)});else panel.webview.postMessage({type:'status',text:'Cancelled. No query was executed.'});};
  function result(value,title) {
    if(!value)return;
    const panel=create(crypto.randomUUID(),title);panel.webview.html=ui.resultPage(title);
    panel.webview.onDidReceiveMessage(m=>{if(m?.type==='ready')postResult(panel,value);});
  }
  function query(p,config,initial='') {
    live(p);const id='query:'+JSON.stringify([p.id,config.database,config.querySchema]);
    if(panels.has(id)){panels.get(id).reveal();return;}
    const panel=create(id,'SQL — '+p.name+'/'+(config.database||'server')+(config.querySchema?'/'+config.querySchema:''));panel.webview.html=ui.queryPage(p,config,initial);let busy=false;
    panel.webview.onDidReceiveMessage(async m=>{
      if(m?.type!=='query'||busy)return;busy=true;
      try {
        live(p);if(typeof m.sql!=='string'||!m.sql.trim()||m.sql.length>1024*1024)throw new Error('Enter SQL (maximum 1 MiB).');
        const yes=await vscode.window.showWarningMessage(`Execute SQL on ${p.name} (${config.host}:${config.port}/${config.database||'server default'}${config.querySchema?'/'+config.querySchema:''})? SQL can modify or delete data.`,{modal:true},'Execute SQL');
        if(yes!=='Execute SQL'){postResult(panel);return;}
        live(p);postResult(panel,await api.invoke(p,'query',{sql:m.sql,confirmed:true,schema:config.querySchema},config));
      }catch(error){panel.webview.postMessage({type:'status',text:error.message,error:true});}finally{busy=false;}
    });
  }
  function edit(existing) {
    api.trust();const id='edit:'+(existing?.id||'new');if(panels.has(id)){panels.get(id).reveal();return;}
    const panel=create(id,existing?'Edit database connection':'Connect to server');let current=existing,busy=false,disposed=false;
    panel.onDidDispose(()=>{disposed=true;});panel.webview.html=ui.connectionPage(existing);
    panel.webview.onDidReceiveMessage(async m=>{
      if(m?.type==='close'){panel.dispose();return;}if(!['test','save','connect'].includes(m?.type)||busy)return;busy=true;
      try {
        api.trust();if(current)live(current);
        const values=m.values;if(!values||typeof values.name!=='string'||!values.name.trim()||values.name.length>200||/[\x00-\x1f]/.test(values.name))throw new Error('Enter a connection name (maximum 200 characters, without control characters).');
        if(typeof values.password!=='string')throw new Error('Enter a password or leave it empty to keep the saved password.');
        const config=connection(values),password=values.password|| (current?await context.secrets.get(secret(current.id)):values.password);
        if(password===undefined)throw new Error('Stored password is missing. Re-enter it before saving or testing.');
        if(current)live(current);
        if(m.type!=='save') {
          if(config.tls===false&&await vscode.window.showWarningMessage(`Test ${config.host}:${config.port} without TLS? Credentials and data can be read on the network.`,{modal:true},'Test without TLS')!=='Test without TLS'){panel.webview.postMessage({type:'status',text:'Cancelled. No connection was attempted.'});return;}
          api.trust();if(current)live(current);
          await api.test(config,password);
          api.trust();if(current)live(current);
          if(m.type==='test'){panel.webview.postMessage({type:'status',text:'Connection successful. Configuration has not been saved.'});return;}
        }
        if(disposed)return;
        const work=mutation.catch(()=>{}).then(async()=>{
          api.trust();if(current)live(current);if(disposed)return;
          const p={id:crypto.randomUUID(),name:values.name.trim(),config};await context.secrets.store(secret(p.id),password);
          try{api.trust();if(current)live(current);if(disposed)throw new Error('Connection editor was closed. Nothing was saved.');await api.save([...api.profiles().filter(x=>x.id!==current?.id),p]);}
          catch(error){await context.secrets.delete(secret(p.id));throw error;}
          const previous=current;current=p;for(const [key,value]of panels)if(value===panel)panels.delete(key);panels.set('edit:'+p.id,panel);
          if(previous)try{await context.secrets.delete(secret(previous.id));}catch{await vscode.window.showWarningMessage('Connection saved, but the previous unused password could not be removed from SecretStorage.');}
          refresh();panel.webview.postMessage({type:'saved'});panel.webview.postMessage({type:'status',text:m.type==='connect'?'Connected and saved. Expand the connection in the Database sidebar to browse.':'Connection saved. Use Test connection to verify connectivity.'});
          if(m.type==='connect')await vscode.commands.executeCommand('devkit.databaseExplorer.focus');
        });mutation=work;await work;
      }catch(error){panel.webview.postMessage({type:'status',text:error.message,error:true});}finally{busy=false;}
    });
  }
  const item=(kind,p,config,args={},label='')=>({kind,p,config,args,label,id:JSON.stringify([p.id,kind,config.database,args.schema,args.table,label]),contextValue:kind==='connection'?'databaseConnection':kind==='table'?'databaseTable':'databaseNode',collapsibleState:1});
  function metadata(n) {
    if(n.kind==='connection')return ['databases',{},n.config,'Databases — '+n.p.name];
    if(n.kind==='database'&&n.config.type==='postgres')return ['schemas',{},n.config,'Schemas — '+n.config.database];
    if(n.kind==='database'||n.kind==='schema')return ['tables',{schema:n.args.schema||n.config.database},n.config,'Tables — '+n.config.database];
    return ['columns',n.args,n.config,'Columns — '+n.args.table];
  }
  function children(n,names) {
    const [action]=metadata(n);
    return names.map(row=>{
      const name=String(row[0]);let child;
      if(action==='databases')child=item('database',n.p,{...n.config,database:name},{},name);
      else if(action==='schemas')child=item('schema',n.p,n.config,{schema:name},name);
      else if(action==='tables'){child=item('table',n.p,n.config,{schema:n.args.schema||n.config.database,table:name},name);child.description=row[1]||'';child.command={command:'devkit.database.preview',title:'Preview rows',arguments:[child]};}
      else return {label:name,description:String(row[1]||''),tooltip:row.map(String).join(' · '),collapsibleState:0,iconPath:new vscode.ThemeIcon('symbol-field')};
      child.iconPath=new vscode.ThemeIcon(action==='tables'?'table':action==='schemas'?'symbol-namespace':'database');return child;
    });
  }
  const provider={onDidChangeTreeData:changes.event,getTreeItem:n=>n,async getChildren(n){
    if(!n)return api.profiles().map(p=>({...item('connection',p,p.config,{},p.name),description:`${p.config.type} ${p.config.host}:${p.config.port}`,iconPath:new vscode.ThemeIcon('plug'),tooltip:`${p.config.host}:${p.config.port} · ${p.config.user} · ${p.config.tls===false?'Plaintext':'Verified TLS'}`}));
    try{
      live(n.p);const [action,args,config]=metadata(n),found=overrides.has(n.id)?{rows:overrides.get(n.id)}:await api.invoke(n.p,action,args,config);if(!found)return [];
      const list=children(n,found.rows||[]);
      if(action==='columns'&&found.truncated)list.push({label:'Column list truncated — increase Maximum result rows in Edit connection',collapsibleState:0});
      if(n.kind==='database'||n.kind==='schema')list.unshift({label:'New SQL query',collapsibleState:0,iconPath:new vscode.ThemeIcon('code'),command:{command:'devkit.database.nodeQuery',title:'New SQL query',arguments:[n]}});
      if(action!=='columns')list.push({label:found.truncated?'More entries — filter or enter exact name…':'Find / filter entries…',description:found.truncated?'Result limit reached':'',collapsibleState:0,command:{command:'devkit.database.find',title:'Find entry',arguments:[n]}});
      if(!found.rows?.length)list.unshift({label:'No entries returned (or insufficient permission)',collapsibleState:0});return list;
    }catch(error){return [{label:'Unable to load — '+error.message,tooltip:error.message,collapsibleState:0,command:{command:'devkit.database.refresh',title:'Retry'}}];}
  }};
  context.subscriptions.push(changes,vscode.window.registerTreeDataProvider('devkit.databaseExplorer',provider));
  const register=(id,fn)=>context.subscriptions.push(vscode.commands.registerCommand(id,async(...args)=>{try{api.trust();await fn(...args);}catch(error){await vscode.window.showErrorMessage(error.message);}}));
  register('devkit.database.refresh',refresh);
  register('devkit.database.preview',async n=>{live(n.p);result(await api.invoke(n.p,'preview',n.args,n.config),n.p.name+' / '+n.config.database+' / '+n.args.table);});
  register('devkit.database.nodeQuery',n=>query(n.p,n.kind==='schema'?{...n.config,querySchema:n.args.schema}:n.config));
  register('devkit.database.find',async n=>{live(n.p);const [action,args,config,title]=metadata(n),name=await api.chooseMetadata(n.p,action,args,config,title);if(name){overrides.set(n.id,[[name]]);changes.fire(n);}});
  context.subscriptions.push({dispose:()=>{for(const p of panels.values())p.dispose();}});
  return {edit,query,result,refresh,provider,browseRoot:()=>vscode.commands.executeCommand('devkit.databaseExplorer.focus')};
}
module.exports={activateBrowser};
