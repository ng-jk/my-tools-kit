'use strict';
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
let collection = { version: 1,id:crypto.randomUUID(), name: 'My collection', variables: {}, requests: [] },catalog=[collection];
let selected = -1, response = null, view = 'body';
const responses=new Map();let pendingRequestId;
let activeTab='query',bodyMode='none',authMode='none',bodyDrafts={},authDrafts={},preRequests=[],deletedRequest;
let editorDrafts={};
const requestKey=request=>JSON.stringify([collection.id,request.id]);
const history = [];
const json = (id, fallback) => { const text = $(id).value.trim(); return text ? JSON.parse(text) : fallback; };
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
function action(fn) { return () => { try { fn(); } catch (e) { notice(e.message, true); } }; }
function blank() { return { id: crypto.randomUUID(), name: 'New request', method: 'GET', url: '', headers: [{name:'Accept',value:'*/*',enabled:true},{name:'User-Agent',value:'Development Tools Kit',enabled:true}], query: [], tests: [] }; }
function headerValues(){const raw=$('headers').value.trim();if(!raw)return [];if(/^[\[{]/.test(raw))return JSON.parse(raw);return raw.split(/\r?\n/).filter(Boolean).map(line=>{const colon=line.indexOf(':');if(colon<1)throw new Error('Headers need Name: value lines or JSON');return {name:line.slice(0,colon).trim(),value:line.slice(colon+1).trim(),enabled:true};});}
function capture() {
  const r = { ...collection.requests[selected], name: $('name').value, method: $('method').value, url: $('url').value, headers: headerValues(), query: json('query', []), tests: json('tests', []), preScript: $('preScript').value, postScript: $('postScript').value, timeout: Number($('timeout').value), followRedirects: $('redirects').checked, extract: json('extract', []), tls: json('tls', {}),preRequests,documentation:$('documentation').value,bodyDrafts,authDrafts };
  const type = $('bodyType').value;
  r.body = type === 'none' ? undefined : type === 'binary' ? { type, file: $('body').value } : type === 'multipart' ? { type, fields: json('body', []) } :type==='graphql'?{type,query:$('body').value,variables:json('graphqlVariables',{}),operationName:$('graphqlOperation').value}: { type, value: type==='form' ? json('body', {}) : $('body').value };
  r.auth = { ...json('auth', {}), type: $('authType').value };
  editorDrafts[requestKey(r)]={bodyDrafts:structuredClone(bodyDrafts),authDrafts:structuredClone(authDrafts)};delete r.bodyDrafts;delete r.authDrafts;
  collection.requests[selected] = r; collection.name = $('collectionName').value;
  return r;
}
function load(index) {
  selected = index; const r = collection.requests[index];
  $('download').disabled=!responses.get(requestKey(r))||!!responses.get(requestKey(r)).results;
  response=responses.get(requestKey(r))||null;if(!response){$('response').textContent='Send this request to inspect its response.';$('metrics').textContent='Status: — · Size: — · Time: —';}else{$('metrics').textContent=`Status: ${response.status} · Size: ${response.size} bytes · Time: ${response.time} ms`;showResponse();}
  for (const key of ['name', 'url', 'preScript', 'postScript','documentation']) $(key).value = r[key] || '';
  $('method').value = r.method || 'GET';
  for (const key of ['headers', 'query', 'tls']) $(key).value = JSON.stringify(r[key] || {}, null, 2);
  for (const key of ['tests', 'extract']) $(key).value = JSON.stringify(r[key] || [], null, 2);
  $('timeout').value = r.timeout || 30000; $('redirects').checked = r.followRedirects !== false;
  $('bodyType').value = r.body?.type || 'none';
  const body = r.body?.file ?? r.body?.fields ?? r.body?.query??r.body?.value ?? '';
  $('body').value = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  $('graphqlVariables').value=JSON.stringify(r.body?.variables||{},null,2);$('graphqlOperation').value=r.body?.operationName||'';
  bodyMode=$('bodyType').value;bodyDrafts=structuredClone(editorDrafts[requestKey(r)]?.bodyDrafts||{});authDrafts=structuredClone(editorDrafts[requestKey(r)]?.authDrafts||{});preRequests=structuredClone(r.preRequests||[]);
  const { type = 'none', ...auth } = r.auth || {}; $('authType').value = type;authMode=type; $('auth').value = JSON.stringify(auth, null, 2); authHint(); render();renderPairs('query');renderPairs('headers');bodyControls();renderTests();renderPreRequests();
}
function render() {
  $('activeCollection').replaceChildren(...catalog.map(c=>{const option=document.createElement('option');option.value=c.id;option.textContent=c.name;return option;}));$('activeCollection').value=collection.id;
  $('requests').replaceChildren();
  collection.requests.forEach((r, i) => {
    if (!(r.name || '').toLowerCase().includes($('search').value.toLowerCase())) return;
    const button = document.createElement('button'); button.className = 'request-item' + (i === selected ? ' selected' : '');
    button.setAttribute('aria-current',String(i===selected));
    const method = document.createElement('span'); method.className = 'method-badge'; method.textContent = r.method || 'GET';
    const name = document.createElement('span'); name.className = 'request-title'; name.textContent = r.name;
    button.append(method, name); button.onclick = action(() => { capture(); load(i);$('requests').querySelector('[aria-current="true"]')?.focus(); }); $('requests').append(button);
  });
}
function authHint() {
  const type=$('authType').value;
  $('authHint').textContent=type==='none'?'No authentication selected.':type==='ntlm'?'NTLMv2 only; requires server extended security and target information.':type==='aws'?'Sign using explicit AWS credentials, region and service.':'Use {{secret.NAME}} placeholders for credentials; session drafts stay in memory.';
  const fields={basic:['username','password'],bearer:['token'],apiKey:['name','value','in'],oauth2:['tokenUrl','clientId','clientSecret','scope','grantType','username','password','code','redirectUri','codeVerifier','refreshToken'],ntlm:['username','password','domain','workstation'],aws:['accessKeyId','secretAccessKey','sessionToken','region','service']};
  let values;try{values=json('auth',{});}catch{return;}$('authFields').replaceChildren();
  for(const key of fields[type]||[]) {
    const label=document.createElement('label');label.textContent=key.replace(/([A-Z])/g,' $1');const input=document.createElement('input');input.dataset.auth=key;input.value=values[key]??'';
    if(/password|secret|token/i.test(key))input.type='password';input.autocomplete='off';input.setAttribute('aria-label',key);
    input.oninput=()=>{values[key]=input.value;$('auth').value=JSON.stringify(values,null,2);};label.append(input);$('authFields').append(label);
  }
}
function busy(value) { $('send').disabled = value; $('run').disabled = value; $('cancel').disabled = !value; }
function showResponse() {
  $('docsPanel').classList.toggle('hidden',view!=='docs');$('response').classList.toggle('hidden',view==='docs');
  if(view==='docs')return;
  if (!response) return;
  const value = response.results || (view === 'body' ? ($('responseRaw').checked?response.body:response.json ?? response.body) :view==='tests'?{tests:response.tests,preRequests:response.preResults}: response[view]);
  $('response').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => {
  activeTab=button.dataset.tab;
  for (const tab of document.querySelectorAll('[data-tab]')) {tab.classList.toggle('active', tab === button);tab.setAttribute('aria-pressed',String(tab===button));}
  for (const panel of document.querySelectorAll('.tab-content')) panel.classList.toggle('hidden', panel.id !== 'tab-' + button.dataset.tab);
};
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => { view = button.dataset.view;for(const item of document.querySelectorAll('[data-view]'))item.setAttribute('aria-pressed',String(item===button));showResponse(); };
$('new').onclick = action(() => { if (selected >= 0) capture(); collection.requests.push(blank()); load(collection.requests.length - 1); });
$('duplicate').onclick = action(() => { const r = capture(); collection.requests.push({ ...structuredClone(r), id: crypto.randomUUID(), name: r.name + ' copy' }); load(collection.requests.length - 1); });
$('delete').onclick = action(() => {capture();deletedRequest={request:collection.requests[selected],index:selected,collectionId:collection.id};collection.requests.splice(selected, 1); if (!collection.requests.length) collection.requests.push(blank()); load(Math.min(selected, collection.requests.length - 1));$('undoDelete').disabled=false;notice('Request removed. Use Undo delete to recover it in its original collection.');});
$('undoDelete').onclick=action(()=>{if(!deletedRequest)return;capture();const origin=catalog.find(c=>c.id===deletedRequest.collectionId);if(!origin)throw new Error('Original collection is unavailable');collection=origin;$('collectionName').value=collection.name;collection.requests.splice(deletedRequest.index,0,deletedRequest.request);load(deletedRequest.index);deletedRequest=undefined;$('undoDelete').disabled=true;saveDraft();});
$('search').oninput = render; $('authType').onchange = ()=>{authDrafts[authMode]=$('auth').value;authMode=$('authType').value;$('auth').value=authDrafts[authMode]||'{}';authHint();};
$('addTest').onclick = action(() => { const tests = json('tests', []); let value = $('testValue').value; try { value = JSON.parse(value); } catch {} tests.push({ source: $('testSource').value, path: $('testPath').value, operator: $('testOperator').value, value }); $('tests').value = JSON.stringify(tests, null, 2);renderTests(); });
for (const type of ['send', 'run']) $(type).onclick = action(() => {
  const request = capture(); const environment = json('environment', {});
  pendingRequestId=requestKey(request);
  busy(true); notice(type === 'send' ? 'Sending request…' : 'Running collection…');
  vscode.postMessage({ type, request,requestKey:pendingRequestId, collection,collections:catalog, environment, allowScripts: $('allowScripts').checked });
});
$('save').onclick = action(() => { capture(); vscode.postMessage({ type: 'save', collection }); });
$('exportPostman').onclick = action(() => { capture(); vscode.postMessage({ type: 'exportPostman', collection }); });
$('saveRequest').onclick = action(() => vscode.postMessage({ type: 'saveRequest', request: capture() }));
$('curl').onclick = action(() => vscode.postMessage({ type: 'curl', request: capture() }));
$('saveEnvironment').onclick = action(() => vscode.postMessage({ type: 'saveEnvironment', environment: json('environment', {}) }));
for (const type of ['open', 'cancel', 'download', 'pipeline', 'secret', 'openEnvironment', 'textTools']) $(type).onclick = () => vscode.postMessage({ type,requestKey:collection.requests[selected]?requestKey(collection.requests[selected]):undefined });
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'idle') busy(false);
  if (message.type === 'error') { busy(false); notice(message.text, true); }
  if (message.type === 'notice') notice(message.text);
  if (message.type === 'environment') { $('environment').value = JSON.stringify(message.value, null, 2); notice('Environment loaded.'); }
  if (message.type === 'collection') {
    $('allowScripts').checked=false;
    capture();collection = message.collection;if(typeof collection.id!=='string'||!collection.id)collection.id=crypto.randomUUID();
    function flatten(folder, defaults = {}) { const inherited = { ...defaults, ...folder.defaults }; return [...(folder.requests || []).map(r => ({ ...inherited, ...r })), ...(folder.folders || []).flatMap(f => flatten(f, inherited))]; }
    collection.requests = flatten(collection); delete collection.folders; delete collection.defaults;
    const requestIds=new Set();for(const request of collection.requests){if(typeof request.id!=='string'||!request.id||requestIds.has(request.id))request.id=crypto.randomUUID();requestIds.add(request.id);}
    if(catalog.some(c=>c.id===collection.id)){const previous=collection.id;collection.id=crypto.randomUUID();collection.name+=' (imported copy)';for(const request of collection.requests)for(const reference of request.preRequests||[])if(reference.collectionId===previous)reference.collectionId=collection.id;}
    catalog.push(collection);
    if (!collection.requests.length) collection.requests.push(blank());
    $('collectionName').value = collection.name; load(0);
    notice(message.warnings.length ? message.warnings.join('\n') : 'Collection loaded.');
  }
  if (message.type === 'result') {
    pendingRequestId=message.requestKey||pendingRequestId;
    responses.set(pendingRequestId,message.result);
    if(responses.size>6)responses.delete(responses.keys().next().value);
    if(!collection.requests[selected]||requestKey(collection.requests[selected])!==pendingRequestId){notice('Background request completed; select its request to inspect the response.');return;}
    response = message.result; $('metrics').textContent = response.results ? `${response.results.length} requests` : `Status: ${response.status} · Size: ${response.size} bytes · Time: ${response.time} ms`;
    $('download').disabled=!!response.results;
    notice(response.passed ? 'Completed successfully.' : 'Completed with failed tests or an HTTP error.', !response.passed);
    history.unshift(new Date().toLocaleTimeString() + ' · ' + (response.status || 'Collection') + ' · ' + (response.passed ? 'PASS' : 'FAIL'));
    $('history').textContent = history.slice(0, 12).join('\n'); showResponse();
  }
});
function rowValues(value){return Array.isArray(value)?value:Object.entries(value||{}).map(([name,value])=>({name,value,enabled:true}));}
function renderPairs(id){
  let rows=id==='headers'?rowValues(headerValues()):rowValues(json(id,[]));
  if(!rows.length)rows=[{name:'',value:'',enabled:true}];
  const container=$(id+'Rows');container.replaceChildren();
  const emit=()=>{$(id).value=JSON.stringify(rows.filter(row=>row.name).map(row=>({...row})),null,2);};
  rows.forEach((row,index)=>{
    row.name??=row.key||'';const line=document.createElement('div');line.className='pair-row';
    const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=row.enabled!==false&&row.disabled!==true;enabled.setAttribute('aria-label',id+' enabled '+(index+1));enabled.onchange=()=>{row.enabled=enabled.checked;delete row.disabled;emit();};
    const key=document.createElement('input');key.value=row.name;key.placeholder=id==='headers'?'Header':'Parameter';key.setAttribute('aria-label',id+' name '+(index+1));key.oninput=()=>{row.name=key.value;emit();};
    const value=document.createElement('input');value.value=row.file??row.value??'';value.placeholder=row.file?'Project-relative file path':'Value';value.setAttribute('aria-label',id+' value '+(index+1));value.oninput=()=>{if(row.file!==undefined)row.file=value.value;else row.value=value.value;emit();};
    const remove=document.createElement('button');remove.textContent='Remove';remove.className='secondary';remove.setAttribute('aria-label','Remove '+id+' row '+(index+1));remove.onclick=()=>{rows.splice(index,1);emit();renderPairs(id);const next=container.querySelectorAll('.pair-row')[Math.min(index,container.children.length-1)];next?.querySelector('input:not([type=checkbox])')?.focus();};
    line.append(enabled,key,value);
    if(id==='body'&&$('bodyType').value==='multipart'){
      const type=document.createElement('select');type.setAttribute('aria-label','Field type '+(index+1));for(const name of ['text','file']){const option=document.createElement('option');option.textContent=name;option.value=name;type.append(option);}type.value=row.file!==undefined?'file':'text';type.onchange=()=>{if(type.value==='file'){row.file=value.value;delete row.value;}else{row.value=value.value;delete row.file;}emit();};line.append(type);
    }
    line.append(remove);container.append(line);
  });
}
function addPair(id){const rows=id==='headers'?rowValues(headerValues()):rowValues(json(id,[]));rows.push({name:'',value:'',enabled:true});$(id).value=JSON.stringify(rows);renderPairs(id);$(id+'Rows').lastElementChild?.querySelector('input:not([type=checkbox])')?.focus();}
function bodyControls(){const type=$('bodyType').value,form=['form','multipart'].includes(type);$('bodyRows').classList.toggle('hidden',!form);$('addBodyField').classList.toggle('hidden',!form);$('bodyLabel').classList.toggle('hidden',form||type==='none');for(const id of ['graphqlVariablesLabel','graphqlOperationLabel'])$(id).classList.toggle('hidden',type!=='graphql');$('binaryHint').classList.toggle('hidden',type!=='binary'&&type!=='multipart');$('formatBody').disabled=type!=='json';if(form)renderPairs('body');}
function renderTests(){
  $('testRows').replaceChildren();json('tests',[]).forEach((test,index)=>{const row=document.createElement('div');row.className='test-row';const text=document.createElement('span');text.textContent=[test.source,test.path,test.operator||'equals',JSON.stringify(test.value)].join(' ');const remove=document.createElement('button');remove.textContent='Remove test';remove.className='secondary';remove.onclick=()=>{const tests=json('tests',[]);tests.splice(index,1);$('tests').value=JSON.stringify(tests,null,2);renderTests();($('testRows').querySelectorAll('button')[Math.min(index,tests.length-1)]||$('addTest')).focus();};row.append(text,remove);$('testRows').append(row);});
}
function renderPreRequests(){
  $('preRequests').replaceChildren();preRequests.forEach((reference,index)=>{
    const row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Pre-request '+(index+1);row.append(legend);
    const enabledLabel=document.createElement('label');enabledLabel.className='check';const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=reference.enabled!==false;enabled.setAttribute('aria-label','Run pre-request '+(index+1));enabledLabel.append(enabled,document.createTextNode('Enabled'));row.append(enabledLabel);
    const updateEnabled=()=>{reference.enabled=enabled.checked;legend.textContent='Pre-request '+(index+1)+(enabled.checked?'':' (disabled — skipped)');};enabled.onchange=updateEnabled;updateEnabled();
    const addSelect=(labelText,items,current,changed)=>{const label=document.createElement('label');label.textContent=labelText;const select=document.createElement('select');select.setAttribute('aria-label',labelText+' '+(index+1));for(const item of [{id:'',name:'Select '+labelText},...items]){const option=document.createElement('option');option.value=item.id??item.name;option.textContent=item.name;select.append(option);}select.value=current||'';select.onchange=()=>changed(select.value);label.append(select);row.append(label);};
    addSelect('Collection',catalog,reference.collectionId,value=>{reference.collectionId=value;reference.requestId='';renderPreRequests();$('preRequests').children[index]?.querySelectorAll('select')[1]?.focus();});
    const source=catalog.find(c=>c.id===reference.collectionId);addSelect('Request',source?.requests||[],reference.requestId,value=>{reference.requestId=value;});
    const remove=document.createElement('button');remove.textContent='Remove pre-request';remove.className='secondary';remove.onclick=()=>{preRequests.splice(index,1);renderPreRequests();($('preRequests').children[Math.min(index,preRequests.length-1)]?.querySelector('select')||$('addPreRequest')).focus();};row.append(remove);$('preRequests').append(row);
  });
}
function rawInputs(){return Object.fromEntries([...document.querySelectorAll('input[id],select[id],textarea[id]')].map(input=>[input.id,input.type==='checkbox'?input.checked:input.value]));}
function saveDraft(){vscode.postMessage({type:'draft',value:{catalog,collectionId:collection.id,selected,inputs:rawInputs(),activeTab,bodyDrafts,authDrafts,bodyMode,authMode,preRequests,editorDrafts,deletedRequest}});}
$('addQuery').onclick=action(()=>addPair('query'));$('addHeader').onclick=action(()=>addPair('headers'));$('addBodyField').onclick=action(()=>addPair('body'));
$('rawHeaders').onchange=action(()=>{if(!$('rawHeaders').checked)renderPairs('headers');$('headers').classList.toggle('hidden',!$('rawHeaders').checked);$('headersRows').classList.toggle('hidden',$('rawHeaders').checked);$('addHeader').classList.toggle('hidden',$('rawHeaders').checked);});
$('bodyType').onchange=action(()=>{bodyDrafts[bodyMode]={text:$('body').value,variables:$('graphqlVariables').value,operation:$('graphqlOperation').value};bodyMode=$('bodyType').value;const draft=bodyDrafts[bodyMode]||{text:['form','multipart'].includes(bodyMode)?'[]':'',variables:'{}',operation:''};$('body').value=draft.text;$('graphqlVariables').value=draft.variables;$('graphqlOperation').value=draft.operation;bodyControls();});
$('formatBody').onclick=()=>vscode.postMessage({type:'formatBody',text:$('body').value});
$('auth').onchange=authHint;$('tests').onchange=action(renderTests);
$('addPreRequest').onclick=()=>{preRequests.push({collectionId:'',requestId:'',enabled:true});renderPreRequests();$('preRequests').lastElementChild.querySelector('select').focus();};
$('activeCollection').onchange=action(()=>{
  const requested=$('activeCollection').value,previous=collection,previousIndex=selected;
  try{capture();}catch(error){$('activeCollection').value=previous.id;throw error;}
  const target=catalog.find(c=>c.id===requested);if(!target){$('activeCollection').value=previous.id;throw new Error('Selected collection is unavailable');}
  try{collection=target;$('collectionName').value=collection.name;load(0);}
  catch(error){collection=previous;$('collectionName').value=previous.name;load(previousIndex);throw error;}
});
$('saveLibrary').onclick=action(()=>{capture();vscode.postMessage({type:'saveLibrary',collections:catalog});});
$('responseRaw').onchange=showResponse;$('responseWrap').onchange=()=>{$('response').classList.toggle('no-wrap',!$('responseWrap').checked);};
$('copyResponse').onclick=()=>vscode.postMessage({type:'copyResponse',text:$('response').textContent});
$('editDocs').onclick=()=>{$('documentation').readOnly=!$('documentation').readOnly;$('editDocs').textContent=$('documentation').readOnly?'Edit':'Save docs';if(!$('documentation').readOnly)$('documentation').focus();else notice('Documentation updated in this request. Save collection to keep it after closing.');};
for(const button of document.querySelectorAll('[data-subtab]'))button.onclick=()=>{for(const item of document.querySelectorAll('[data-group="'+button.dataset.group+'"]')){$(item.dataset.subtab).classList.toggle('hidden',item!==button);item.setAttribute('aria-pressed',String(item===button));}};
document.addEventListener('input',event=>{if(['name','method','collectionName'].includes(event.target.id)){if(collection.requests[selected]){collection.requests[selected].name=$('name').value;collection.requests[selected].method=$('method').value;}collection.name=$('collectionName').value;render();}saveDraft();});document.addEventListener('change',()=>saveDraft());document.addEventListener('click',()=>queueMicrotask(saveDraft));
window.addEventListener('message',event=>{
  if(event.data.type==='bodyFormatted'){if($('body').value===event.data.original){$('body').value=event.data.text;notice('JSON formatted without changing number or string values.');saveDraft();}else notice('Body changed while formatting; current input retained.');return;}
  if(event.data.type!=='draft')return;
  const draft=event.data.value;catalog=draft.catalog;editorDrafts=draft.editorDrafts||{};collection=catalog.find(c=>c.id===draft.collectionId);if(!collection)return;
  load(draft.selected);
  for(const [id,value] of Object.entries(draft.inputs||{})){if(!$(id))continue;if($(id).type==='checkbox')$(id).checked=value;else $(id).value=value;}
  bodyDrafts=draft.bodyDrafts||{};authDrafts=draft.authDrafts||{};bodyMode=draft.bodyMode;authMode=draft.authMode;preRequests=draft.preRequests||[];
  deletedRequest=draft.deletedRequest;$('undoDelete').disabled=!deletedRequest;
  authHint();
  for(const render of [()=>renderPairs('query'),()=>$('rawHeaders').onchange(),bodyControls,renderTests,renderPreRequests])try{render();}catch{}
  document.querySelector('[data-tab="'+draft.activeTab+'"]').click();notice('Unsaved session draft restored.');
});
collection.requests.push(blank()); load(0);
for(const button of document.querySelectorAll('[data-tab]'))button.setAttribute('aria-pressed',String(button.dataset.tab==='query'));
for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view==='body'));
vscode.postMessage({type:'ready'});
