'use strict';
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
let collection = { version: 1, name: 'My collection', variables: {}, requests: [] };
let selected = -1, response = null, view = 'body';
const history = [];
const json = (id, fallback) => { const text = $(id).value.trim(); return text ? JSON.parse(text) : fallback; };
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
function action(fn) { return () => { try { fn(); } catch (e) { notice(e.message, true); } }; }
function blank() { return { id: crypto.randomUUID(), name: 'New request', method: 'GET', url: '', headers: {}, query: {}, tests: [] }; }
function capture() {
  const r = { ...collection.requests[selected], name: $('name').value, method: $('method').value, url: $('url').value, headers: json('headers', {}), query: json('query', {}), tests: json('tests', []), preScript: $('preScript').value, postScript: $('postScript').value, timeout: Number($('timeout').value), followRedirects: $('redirects').checked, extract: json('extract', []), tls: json('tls', {}) };
  const type = $('bodyType').value;
  r.body = type === 'none' ? undefined : type === 'binary' ? { type, file: $('body').value } : type === 'multipart' ? { type, fields: json('body', []) } : { type, value: ['json', 'form'].includes(type) ? json('body', {}) : $('body').value };
  r.auth = { ...json('auth', {}), type: $('authType').value };
  collection.requests[selected] = r; collection.name = $('collectionName').value;
  return r;
}
function load(index) {
  selected = index; const r = collection.requests[index];
  for (const key of ['name', 'url', 'preScript', 'postScript']) $(key).value = r[key] || '';
  $('method').value = r.method || 'GET';
  for (const key of ['headers', 'query', 'tls']) $(key).value = JSON.stringify(r[key] || {}, null, 2);
  for (const key of ['tests', 'extract']) $(key).value = JSON.stringify(r[key] || [], null, 2);
  $('timeout').value = r.timeout || 30000; $('redirects').checked = r.followRedirects !== false;
  $('bodyType').value = r.body?.type || 'none';
  const body = r.body?.file ?? r.body?.fields ?? r.body?.value ?? '';
  $('body').value = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  const { type = 'none', ...auth } = r.auth || {}; $('authType').value = type; $('auth').value = JSON.stringify(auth, null, 2); authHint(); render();
}
function render() {
  $('requests').replaceChildren();
  collection.requests.forEach((r, i) => {
    if (!(r.name || '').toLowerCase().includes($('search').value.toLowerCase())) return;
    const button = document.createElement('button'); button.className = 'request-item' + (i === selected ? ' selected' : '');
    const method = document.createElement('span'); method.className = 'method-badge'; method.textContent = r.method || 'GET';
    const name = document.createElement('span'); name.className = 'request-title'; name.textContent = r.name;
    button.append(method, name); button.onclick = action(() => { capture(); load(i); }); $('requests').append(button);
  });
}
function authHint() { $('authHint').textContent = ({ none: 'No authentication', bearer: '{ "token": "{{secret.TOKEN}}" }', basic: '{ "username": "user", "password": "{{secret.PASSWORD}}" }', apiKey: '{ "name": "X-API-Key", "value": "{{secret.KEY}}", "in": "header" }', oauth2: '{ "tokenUrl": "https://…/token", "clientId": "…", "clientSecret": "{{secret.CLIENT_SECRET}}", "scope": "…" }' })[$('authType').value]; }
function busy(value) { $('send').disabled = value; $('run').disabled = value; $('cancel').disabled = !value; }
function showResponse() {
  if (!response) return;
  const value = response.results || (view === 'body' ? (response.json ?? response.body) : response[view]);
  $('response').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => {
  for (const tab of document.querySelectorAll('[data-tab]')) tab.classList.toggle('active', tab === button);
  for (const panel of document.querySelectorAll('.tab-content')) panel.classList.toggle('hidden', panel.id !== 'tab-' + button.dataset.tab);
};
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => { view = button.dataset.view; showResponse(); };
$('new').onclick = action(() => { if (selected >= 0) capture(); collection.requests.push(blank()); load(collection.requests.length - 1); });
$('duplicate').onclick = action(() => { const r = capture(); collection.requests.push({ ...structuredClone(r), id: crypto.randomUUID(), name: r.name + ' copy' }); load(collection.requests.length - 1); });
$('delete').onclick = action(() => { collection.requests.splice(selected, 1); if (!collection.requests.length) collection.requests.push(blank()); load(Math.min(selected, collection.requests.length - 1)); });
$('search').oninput = render; $('authType').onchange = authHint;
$('addTest').onclick = action(() => { const tests = json('tests', []); let value = $('testValue').value; try { value = JSON.parse(value); } catch {} tests.push({ source: $('testSource').value, path: $('testPath').value, operator: $('testOperator').value, value }); $('tests').value = JSON.stringify(tests, null, 2); });
for (const type of ['send', 'run']) $(type).onclick = action(() => {
  const request = capture(); const environment = { ...collection.variables, ...json('environment', {}) };
  busy(true); notice(type === 'send' ? 'Sending request…' : 'Running collection…');
  vscode.postMessage({ type, request, collection, environment, allowScripts: $('allowScripts').checked });
});
$('save').onclick = action(() => { capture(); vscode.postMessage({ type: 'save', collection }); });
$('exportPostman').onclick = action(() => { capture(); vscode.postMessage({ type: 'exportPostman', collection }); });
$('saveRequest').onclick = action(() => vscode.postMessage({ type: 'saveRequest', request: capture() }));
$('curl').onclick = action(() => vscode.postMessage({ type: 'curl', request: capture() }));
$('saveEnvironment').onclick = action(() => vscode.postMessage({ type: 'saveEnvironment', environment: json('environment', {}) }));
for (const type of ['open', 'cancel', 'download', 'pipeline', 'secret', 'openEnvironment', 'textTools']) $(type).onclick = () => vscode.postMessage({ type });
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'idle') busy(false);
  if (message.type === 'error') { busy(false); notice(message.text, true); }
  if (message.type === 'notice') notice(message.text);
  if (message.type === 'environment') { $('environment').value = JSON.stringify(message.value, null, 2); notice('Environment loaded.'); }
  if (message.type === 'collection') {
    collection = message.collection;
    function flatten(folder, defaults = {}) { const inherited = { ...defaults, ...folder.defaults }; return [...(folder.requests || []).map(r => ({ ...inherited, ...r })), ...(folder.folders || []).flatMap(f => flatten(f, inherited))]; }
    collection.requests = flatten(collection); delete collection.folders; delete collection.defaults;
    if (!collection.requests.length) collection.requests.push(blank());
    $('collectionName').value = collection.name; load(0);
    notice(message.warnings.length ? message.warnings.join('\n') : 'Collection loaded.');
  }
  if (message.type === 'result') {
    response = message.result; $('metrics').textContent = response.results ? `${response.results.length} requests` : `${response.status} · ${response.time} ms · ${response.size} bytes`;
    notice(response.passed ? 'Completed successfully.' : 'Completed with failed tests or an HTTP error.', !response.passed);
    history.unshift(new Date().toLocaleTimeString() + ' · ' + (response.status || 'Collection') + ' · ' + (response.passed ? 'PASS' : 'FAIL'));
    $('history').textContent = history.slice(0, 12).join('\n'); showResponse();
  }
});
collection.requests.push(blank()); load(0);
