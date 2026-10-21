'use strict';
const crypto=require('node:crypto');
const {connection,run}=require('../../build/sftp/database');
function activateDatabase(vscode,context) {
  const key='devkit.database.connections',secret=id=>'devkit.database.password.'+id;
  const profiles=()=>context.globalState?.get(key,[])||[];
  const trust=()=>{if(!vscode.workspace.isTrusted)throw new Error('Trust the workspace before connecting to a database');};
  let workbench;
  const save=async items=>{await context.globalState.update(key,items);workbench?.refresh();};
  async function pick(){return vscode.window.showQuickPick(profiles().map(p=>({label:p.name,description:`${p.config.type} ${p.config.host}:${p.config.port} / ${p.config.database||'(choose database)'}`,profile:p})),{title:'Database — choose a connection',placeHolder:'Add Connection from the Database menu if none are saved'}).then(p=>p?.profile);}
  async function invoke(p,action,args={},config=p.config) {
    trust();
    const current=()=>{if(!profiles().some(value=>value.id===p.id))throw new Error('Database connection changed or was removed. Choose the connection again.');};
    current();
    if(config.tls===false && await vscode.window.showWarningMessage(`Connect to ${config.host}:${config.port} without TLS? Credentials and data can be read on the network.`,{modal:true},'Connect without TLS')!=='Connect without TLS')return;
    const password=await context.secrets.get(secret(p.id));
    if(password===undefined)throw new Error('The stored database password is missing. Use Database: Edit Connection to re-enter it; no connection was attempted.');
    current();
    return vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`Database: ${action} — ${p.name} (${config.host}/${config.database||'server'})`,cancellable:false},()=>{trust();current();return run(config,password,action,args);});
  }
  async function result(value,title){if(!value)return;if(workbench)return workbench.result(value,title);const doc=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(value,null,2)});await vscode.window.showTextDocument(doc,{preview:false});if(value.truncated)await vscode.window.showWarningMessage(`${title}: result truncated at the row or 8 MiB limit. Refine SQL with WHERE/LIMIT; terminal configurations also support maxRows up to 5000.`);}
  async function add(existing,original={id:existing?.id}) {
    trust();
    if(workbench)return workbench.edit(existing);
    const current=existing?.config||{},input=async(prompt,value,password=false,validateInput)=>vscode.window.showInputBox({prompt,value:value||'',password,ignoreFocusOut:true,validateInput});
    const text=value=>/[\x00-\x1f]/.test(value)?'Use one line without control characters':undefined;
    const required=value=>!value.trim()?'A value is required':text(value);
    const name=await input('Connection name',existing?.name,false,required);if(!name?.trim())return;
    const type=await vscode.window.showQuickPick(['mysql','mariadb','postgres'],{title:'Database engine'});if(!type)return;
    const host=await input('Database hostname or IP address',current.host||'localhost',false,value=>required(value)||(/[\s/@?#]/.test(value)?'Enter a hostname or IP, without URL, spaces or credentials':undefined));if(host===undefined)return;
    const port=await input('Database port',String(current.port||(type==='postgres'?5432:3306)),false,value=>Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=65535?undefined:'Enter a port from 1 to 65535');if(port===undefined)return;
    const user=await input('Database username',current.user,false,required);if(user===undefined)return;
    const database=await input('Initial database (PostgreSQL usually postgres; MySQL may be empty)',current.database||(type==='postgres'?'postgres':''),false,text);if(database===undefined)return;
    const security=await vscode.window.showQuickPick(['Verified TLS (recommended)','Plaintext (trusted private network only)'],{title:'Database transport security'});if(!security)return;
    let caPath='';if(security.startsWith('Verified')){caPath=await input('CA certificate file path (empty uses system trusted roots)',current.caPath,false,text);if(caPath===undefined)return;}
    const password=await input('Database password (stored only in VS Code SecretStorage; re-enter when editing)','',true);if(password===undefined)return;
    const config=connection({type,host,port,user,database,tls:security.startsWith('Verified'),caPath});
    // New immutable credential identity on edit: pending commands must never
    // combine a captured old host with replacement credentials.
    const p={id:crypto.randomUUID(),name:name.trim(),config};
    for(;;){
      try {
        trust();
        if(config.tls===false&&await vscode.window.showWarningMessage(`Test ${host}:${port} without TLS? This sends credentials and data without transport encryption.`,{modal:true},'Test without TLS')!=='Test without TLS')return;
        await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Testing database connection',cancellable:false},()=>run(config,password,'test'));
        trust();await context.secrets.store(secret(p.id),password);
        try {await save([...profiles().filter(x=>x.id!==p.id&&x.id!==original.id),p]);}
        catch(error){await context.secrets.delete(secret(p.id));throw error;}
        if(original.id)try{await context.secrets.delete(secret(original.id));}catch{await vscode.window.showWarningMessage('Connection saved, but the previous unused password could not be removed from SecretStorage.');}
        await vscode.window.showInformationMessage('Database connection tested and saved: '+p.name);return;
      }catch(error){const choice=await vscode.window.showErrorMessage(error.message,'Retry','Edit connection');if(choice==='Retry')continue;if(choice==='Edit connection')return add({...p},original);return;}
    }
  }
  async function chooseMetadata(p,action,args,config,title) {
    let filter;
    for(;;){
      const found=await invoke(p,action,{...args,filter},config);if(!found)return;
      if(found.truncated||!found.rows.length){
        const message=found.truncated?`${title}: only the first ${found.rows.length} entries fit the result limit. Filter on the server or enter an exact name to reach other entries.`:`${title}: no entries matched or this account cannot list them. Filter again or enter a known exact name.`;
        const choice=await vscode.window.showWarningMessage(message,'Filter list','Enter exact name',...(found.rows.length?['Use listed entries']:[]));
        if(choice==='Enter exact name'){const value=await vscode.window.showInputBox({prompt:`Exact name — ${title}`,ignoreFocusOut:true,validateInput:v=>!v||/[\x00-\x1f]/.test(v)?'Enter one nonempty name without control characters':undefined});return value;}
        if(choice==='Filter list'){filter=await vscode.window.showInputBox({prompt:'Server-side LIKE filter: % matches any text, _ one character; empty resets',value:filter||'',ignoreFocusOut:true,validateInput:v=>v.length>256||/[\x00-\x1f]/.test(v)?'Use at most 256 characters, without control characters':undefined});if(filter===undefined)return;continue;}
        if(choice!=='Use listed entries')return;
      }
      return (await vscode.window.showQuickPick(found.rows.map(row=>({label:String(row[0]),description:row[1]===undefined?'':String(row[1])})),{title,placeHolder:'Type to search listed entries; Escape returns to the editor'}))?.label;
    }
  }
  async function chooseDatabase(p) {
    const selected=await chooseMetadata(p,'databases',{},p.config,`Database on ${p.name}`);if(!selected)return;
    return {...p.config,database:selected};
  }
  async function query(p,config=p.config,initial) {
    let sql=initial;
    if(sql===undefined){const editor=vscode.window.activeTextEditor;if(editor?.document.languageId==='sql')sql=editor.selection.isEmpty?editor.document.getText():editor.document.getText(editor.selection);}
    if(workbench)return workbench.query(p,config,sql||'');
    if(!sql?.trim()) {
      const doc=await vscode.workspace.openTextDocument({language:'sql',content:'-- Write SQL here, then run Database: Execute SQL.\n'});await vscode.window.showTextDocument(doc);return;
    }
    trust();
    const confirm=await vscode.window.showWarningMessage(`Execute SQL on ${p.name} (${config.host}:${config.port}/${config.database||'server default'})? SQL can modify or delete data. Only the selected text is run when a selection exists.`,{modal:true},'Execute SQL');if(confirm!=='Execute SQL')return;
    await result(await invoke(p,'query',{sql,confirmed:true},config),'SQL');
  }
  async function browse(p) {
    const config=await chooseDatabase(p);if(!config)return;
    let schema=config.database;
    if(config.type==='postgres') {
      schema=await chooseMetadata(p,'schemas',{},config,`Schema in ${config.database}`);if(!schema)return;
    }
    for(;;){
      const table=await chooseMetadata(p,'tables',{schema},config,`Tables and views — ${p.name}/${config.database}/${schema}`);if(!table)return;
      const action=await vscode.window.showQuickPick(['Preview rows','Browse columns','Execute SQL in this database','Back to tables'],{title:table});
      if(!action)return;if(action==='Back to tables')continue;
      if(action==='Execute SQL in this database')await query(p,config);
      else await result(await invoke(p,action==='Preview rows'?'preview':'columns',{schema,table},config),table);
    }
  }
  if(vscode.window.createWebviewPanel&&vscode.EventEmitter)workbench=require('./database-browser').activateBrowser(vscode,context,{profiles,save,trust,invoke,chooseMetadata,test:(config,password)=>run(config,password,'test')});
  const handlers={
    'devkit.database.add':()=>add(),
    'devkit.database.browse':async()=>{if(workbench)return workbench.browseRoot();const p=await pick();if(p)await browse(p);},
    'devkit.database.query':async()=>{const p=await pick();if(p){const config=await chooseDatabase(p);if(config)await query(p,config);}},
    'devkit.database.edit':async node=>{const p=node?.p||await pick();if(p)await add(p);},
    'devkit.database.remove':async node=>{const p=node?.p||await pick();if(p&&await vscode.window.showWarningMessage(`Remove saved connection ${p.name}? This deletes its stored password, not the remote database.`,{modal:true},'Remove connection')==='Remove connection'){trust();await context.secrets.delete(secret(p.id));await save(profiles().filter(x=>x.id!==p.id));}},
    'devkit.database.test':async node=>{const p=node?.p||await pick();if(p)await result(await invoke(p,'test'),'Connection test');},
    'devkit.database.menu':async()=>{
      const actions=[['Add Connection','add'],['Browse Databases / Schemas / Tables','browse'],['Execute SQL','query'],['Test Connection','test'],['Edit Connection','edit'],['Remove Connection','remove']];
      const chosen=await vscode.window.showQuickPick(actions.map(([label,id])=>({label,id})),{title:'Database — choose a function'});if(chosen)await handlers['devkit.database.'+chosen.id]();
    }
  };
  for(const [id,fn]of Object.entries(handlers))context.subscriptions.push(vscode.commands.registerCommand(id,async(...args)=>{try{trust();await fn(...args);}catch(error){await vscode.window.showErrorMessage(error.message);}}));
}
module.exports={activateDatabase};
