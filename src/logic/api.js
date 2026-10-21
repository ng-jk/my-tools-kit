'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { inside, readBuffer } = require('../data/files');
const { transport } = require('../data/http');
const { script } = require('../data/scripts');
const {sign}=require('../../build/sftp/api-auth');
const {ntlmTransport}=require('../data/ntlm');

function substitute(value, variables, seen = []) {
  if (typeof value === 'string') return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
    if (key === '$uuid') return crypto.randomUUID();
    if (key === '$timestamp') return String(Date.now());
    if (!Object.hasOwn(variables, key)) throw new Error('Missing variable: ' + key);
    if (seen.includes(key) || seen.length >= 20) throw new Error('Circular or deeply nested variable: ' + key);
    return substitute(String(variables[key]), variables, [...seen, key]);
  });
  if (Array.isArray(value)) return value.map(v => substitute(v, variables, seen));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, variables, seen)]));
  return value;
}
function pairs(value) {
  return Array.isArray(value) ? value.filter(x => x.enabled !== false && x.disabled !== true && (x.name??x.key)).map(x => [x.name ?? x.key, x.value ?? '']) : Object.entries(value || {});
}
function requestTemplate(request,variables={}){
  const {documentation,name,id,preRequests,collections,variables:collectionDefaults,bodyDrafts,authDrafts,...template}=request;
  const enabled=rows=>Array.isArray(rows)?rows.filter(row=>row&&row.enabled!==false&&row.disabled!==true&&(row.name??row.key)):rows;
  template.headers=enabled(template.headers);template.query=enabled(template.query);
  if(template.body){
    const body=template.body;
    if(body.type==='none')template.body={type:'none'};
    else if(body.type==='form')template.body={type:'form',value:enabled(body.value)};
    else if(body.type==='multipart')template.body={type:'multipart',fields:enabled(body.fields)};
    else if(body.type==='binary')template.body={type:'binary',file:body.file};
  }
  if(template.auth){
    const auth={...template.auth,type:substitute(template.auth.type,variables)},fields={none:[],bearer:['token'],basic:['username','password'],apiKey:['name','value','in'],ntlm:['username','password','domain','workstation'],aws:['accessKeyId','secretAccessKey','sessionToken','region','service']};
    let selected=fields[auth.type];
    if(auth.type==='oauth2')selected=['tokenUrl','clientId','clientSecret','scope','grantType',...({password:['username','password'],authorization_code:['code','redirectUri','codeVerifier'],refresh_token:['refreshToken']}[substitute(auth.grantType,variables)]||[])];
    if(selected)template.auth=Object.fromEntries(['type',...selected].filter(key=>Object.hasOwn(auth,key)).map(key=>[key,auth[key]]));
  }
  return template;
}
function referencedSecrets(requests,environment={}){
  const names=new Set();
  for(const request of requests){
    const variables={...request.variables,...environment};
    const key=(name,seen=[])=>{
      if(/^secret\.[A-Za-z_][A-Za-z0-9_]*$/.test(name)){names.add(name.slice(7));return;}
      if(seen.includes(name)||seen.length>=20||!Object.hasOwn(variables,name))return;
      walk(variables[name],[...seen,name]);
    };
    const walk=(value,seen=[])=>{if(typeof value==='string'){for(const match of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))key(match[1],seen);}else if(Array.isArray(value))value.forEach(item=>walk(item,seen));else if(value&&typeof value==='object')Object.values(value).forEach(item=>walk(item,seen));};
    walk(requestTemplate(request,variables));
    for(const script of [request.preScript,request.postScript])for(const match of String(script||'').matchAll(/env\.get\(\s*['"]([^'"]+)['"]\s*\)/g))key(match[1]);
  }
  return [...names];
}
function jsonPath(value, pointer = '') {
  return pointer.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((v, key) => v?.[key], value);
}
function assertions(tests = [], response) {
  return tests.map(t => {
    let actual;
    if (t.source === 'status') actual = response.status;
    else if (t.source === 'time') actual = response.time;
    else if (t.source === 'header') actual = response.headers[String(t.path).toLowerCase()];
    else if (t.source === 'body') actual = response.body;
    else if (t.source === 'json') actual = jsonPath(response.json, t.path);
    else return { name: t.name || t.source, passed: false, error: 'Unknown assertion source' };
    const operations = {
      equals: () => isDeepStrictEqual(actual, t.value),
      contains: () => typeof actual === 'string' ? actual.includes(String(t.value)) : Array.isArray(actual) && actual.some(v => isDeepStrictEqual(v, t.value)),
      exists: () => actual !== undefined && actual !== null,
      lessThan: () => typeof actual === 'number' && actual < Number(t.value),
      notEquals: () => !isDeepStrictEqual(actual, t.value)
    };
    const passed = operations[t.operator || 'equals']?.() ?? false;
    return { name: t.name || `${t.source} ${t.path || ''} ${t.operator || 'equals'}`, passed, ...(passed ? {} : { error: 'Assertion failed' }) };
  });
}
class CookieJar {
  constructor() { this.cookies = []; }
  set(url, values) {
    for (const value of values || []) {
      const [pair, ...attrs] = value.split(';'); const index = pair.indexOf('=');
      if (index < 1) continue;
      const cookie = { name: pair.slice(0, index).trim(), value: pair.slice(index + 1), domain: url.hostname, hostOnly: true, path: url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) || '/', secure: false };
      for (const attr of attrs) {
        const [key, ...rest] = attr.trim().split('='); const val = rest.join('=');
        if (key.toLowerCase() === 'path' && val.startsWith('/')) cookie.path = val;
        if (key.toLowerCase() === 'secure') cookie.secure = true;
        if(key.toLowerCase()==='httponly')cookie.httpOnly=true;
        if(key.toLowerCase()==='samesite')cookie.sameSite=val;
        if (key.toLowerCase() === 'max-age' && /^-?\d+$/.test(val)) cookie.expires = Date.now() + Number(val) * 1000;
        if (key.toLowerCase() === 'expires' && !cookie.expires) cookie.expires = Date.parse(val);
        // Host-only storage deliberately avoids public-suffix/domain sharing errors.
      }
      this.cookies = this.cookies.filter(c => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path));
      this.cookies.push(cookie);
    }
  }
  get(url) { return this.cookies.filter(c => c.domain === url.hostname && (url.pathname === c.path || url.pathname.startsWith(c.path.endsWith('/') ? c.path : c.path + '/')) && (!c.secure || url.protocol === 'https:') && (!c.expires || c.expires > Date.now())).map(c => `${c.name}=${c.value}`).join('; '); }
}
function buildBody(body, headers, root) {
  if (!body || body.type === 'none') return undefined;
  if (body.type === 'json') { headers['content-type'] ||= 'application/json'; return Buffer.from(typeof body.value === 'string' ? body.value : JSON.stringify(body.value)); }
  if(body.type==='xml'){headers['content-type']||='application/xml';return Buffer.from(String(body.value??''));}
  if(body.type==='graphql'){headers['content-type']||='application/json';const value=body.variables||{};if(typeof value!=='object'||Array.isArray(value))throw new Error('GraphQL variables must be a JSON object');return Buffer.from(JSON.stringify({query:String(body.query??body.value??''),variables:value,...(body.operationName?{operationName:body.operationName}:{})}));}
  if (body.type === 'form') { headers['content-type'] ||= 'application/x-www-form-urlencoded'; return Buffer.from(new URLSearchParams(pairs(body.value)).toString()); }
  if (body.type === 'binary') {if(typeof body.file!=='string'||!body.file.trim())throw new Error('Binary body requires a project-relative file path');headers['content-type']||='application/octet-stream';return readBuffer(inside(root, body.file));}
  if (body.type === 'multipart') {
    const boundary = 'devkit-' + crypto.randomUUID(); headers['content-type'] = 'multipart/form-data; boundary=' + boundary;
    const chunks = [];
    for (const field of (body.fields || []).filter(field=>field.enabled!==false&&field.disabled!==true)) {
      if(typeof field.name!=='string'||!field.name)throw new Error('Multipart field name is required');
      if (/[\r\n"]/.test(field.name)) throw new Error('Invalid multipart field name');
      let disposition = `Content-Disposition: form-data; name="${field.name}"`;
      let value = Buffer.from(String(field.value ?? ''));
      if (Object.hasOwn(field,'file')) {
        if(typeof field.file!=='string'||!field.file.trim())throw new Error('Multipart file path is required for field '+field.name);
        const filename = path.basename(field.file).replace(/["\r\n]/g, '_');
        disposition += `; filename="${filename}"\r\nContent-Type: application/octet-stream`;
        value = readBuffer(inside(root, field.file));
      }
      chunks.push(Buffer.from(`--${boundary}\r\n${disposition}\r\n\r\n`), value, Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`)); return Buffer.concat(chunks);
  }
  if (body.type !== 'text') throw new Error('Unknown body type: ' + body.type);
  return Buffer.from(String(body.value ?? ''));
}
async function execute(request, options = {}) {
  if (!request || typeof request.url !== 'string' || !request.url.trim()) throw new Error('Request URL is required');
  if (request.timeout !== undefined && (!Number.isFinite(request.timeout) || request.timeout <= 0)) throw new Error('Timeout must be a positive number');
  if (request.tests !== undefined && !Array.isArray(request.tests)) throw new Error('Tests must be an array');
  if(request.preRequests!==undefined&&!Array.isArray(request.preRequests))throw new Error('Pre-requests must be an array');
  const start = performance.now(); const root = options.root || process.cwd();
  let variables = { ...options.variables }; const tests = [], logs = [],preResults=[];
  const jar=options.jar||new CookieJar();
  if((options.preDepth||0)>10)throw new Error('Pre-request dependency depth or cycle limit exceeded');
  const budget=options.preBudget||{count:0};
  for(const reference of request.preRequests||[]) {
    if(reference.enabled===false)continue;
    if(++budget.count>100)throw new Error('Pre-request execution limit exceeded');
    const collection=(options.collections||request.collections||[]).find(c=>(c.id||c.name)===reference.collectionId);
    const preRequest=collection&&flatten(collection).find(r=>(r.id||r.name)===reference.requestId);
    if(!preRequest)throw new Error('Pre-request not found in the selected collection');
    const key=JSON.stringify([reference.collectionId,reference.requestId]),stack=options.preStack||[];
    if(stack.includes(key))throw new Error('Pre-request dependency cycle');
    const result=await execute(preRequest,{...options,variables,collectionVariables:collection.variables,exportGlobalsOnly:true,jar,preDepth:(options.preDepth||0)+1,preStack:[...stack,key],preBudget:budget});
    preResults.push({name:preRequest.name,status:result.status,time:result.time,passed:result.passed,tests:result.tests});
    if(!result.passed)throw new Error('Pre-request failed: '+(preRequest.name||reference.requestId));
    variables=result.variables;
  }
  const globalVariables={...variables},initialVariables={...options.collectionVariables,...variables};variables={...initialVariables};
  const pre = await script(request.preScript, request, null, variables, options); variables = pre.variables; tests.push(...pre.tests); logs.push(...pre.logs);
  const r = substitute({ ...requestTemplate(pre.request||request,variables), preScript: undefined, postScript: undefined }, variables);
  let url = new URL(r.url); for (const [k, v] of pairs(r.query)) url.searchParams.append(k, v);
  let headers = Object.fromEntries(pairs(r.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  headers['accept-encoding'] = 'identity';
  const auth = r.auth || {};
  if (auth.type === 'basic') headers.authorization = 'Basic ' + Buffer.from(`${auth.username || ''}:${auth.password || ''}`).toString('base64');
  else if (auth.type === 'bearer') headers.authorization = 'Bearer ' + auth.token;
  else if (auth.type === 'apiKey') { if (auth.in === 'query') url.searchParams.set(auth.name, auth.value); else headers[auth.name.toLowerCase()] = auth.value; }
  else if (auth.type === 'oauth2') {
    const grant=auth.grantType||'client_credentials';if(!['client_credentials','password','authorization_code','refresh_token'].includes(grant))throw new Error('Unsupported OAuth grant type');
    const fields={grant_type:grant,...(auth.scope?{scope:auth.scope}:{})};
    for(const [key,value] of Object.entries(grant==='password'?{username:auth.username,password:auth.password}:grant==='authorization_code'?{code:auth.code,redirect_uri:auth.redirectUri,...(auth.codeVerifier?{code_verifier:auth.codeVerifier}:{})}:grant==='refresh_token'?{refresh_token:auth.refreshToken}:{})){if(!value)throw new Error('OAuth grant requires '+key);fields[key]=value;}
    if(!auth.clientSecret)fields.client_id=auth.clientId;
    const token = await execute({ url: auth.tokenUrl, method: 'POST', auth: auth.clientSecret?{ type: 'basic', username: auth.clientId, password: auth.clientSecret }:{type:'none'}, body: { type: 'form', value: fields } }, { ...options, allowScripts: false });
    if (token.status >= 400 || !token.json?.access_token) throw new Error('OAuth token request failed');
    headers.authorization = 'Bearer ' + token.json.access_token;
  } else if (auth.type && !['none','aws','ntlm'].includes(auth.type)) throw new Error('Unsupported authentication type: ' + auth.type);
  let method = (r.method || 'GET').toUpperCase();
  let body = buildBody(r.body, headers, root);
  const tls = {};
  for (const key of ['ca', 'cert', 'key']) if (r.tls?.[key]) tls[key] = readBuffer(inside(root, r.tls[key]));
  if (r.tls?.passphrase) tls.passphrase = r.tls.passphrase;
  let response;
  for (let redirects = 0; ; redirects++) {
    const outgoing = { ...headers }; const cookie = jar.get(url); if (cookie && !outgoing.cookie) outgoing.cookie = cookie;
    if(auth.type==='aws'){
      for(const field of ['accessKeyId','secretAccessKey','region','service'])if(!auth[field])throw new Error('AWS authentication requires '+field);
      const signed=sign({host:url.host,path:url.pathname+url.search,method,headers:outgoing,body,region:auth.region,service:auth.service},{accessKeyId:auth.accessKeyId,secretAccessKey:auth.secretAccessKey,sessionToken:auth.sessionToken});
      Object.assign(outgoing,signed.headers);
    }
    response = await (auth.type==='ntlm'?ntlmTransport:transport)(url, { method, headers: outgoing, body, tls }, { ...options, timeout: r.timeout || options.timeout },auth);
    jar.set(url, response.headers['set-cookie']);
    if (!r.followRedirects && r.followRedirects !== undefined) break;
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.location) break;
    if (redirects >= 5) throw new Error('Too many redirects');
    const next = new URL(response.headers.location, url);
    if (next.origin !== url.origin) throw new Error('Cross-origin redirect blocked; send a separate request to the destination');
    if (response.status === 303 && method !== 'HEAD' || [301, 302].includes(response.status) && method === 'POST') { method = 'GET'; body = undefined; delete headers['content-type']; delete headers['content-length']; }
    url = next;
  }
  const result = { status: response.status, headers: response.headers, size: response.size, time: Math.round(performance.now() - start), body: response.buffer.toString('utf8'), base64: response.buffer.toString('base64') };
  try { result.json = JSON.parse(result.body); } catch { /* Non-JSON response. */ }
  tests.push(...assertions(r.tests, result));
  const post = await script(request.postScript, r, result, variables, options); variables = post.variables; tests.push(...post.tests); logs.push(...post.logs);
  for (const extraction of r.extract || []) {
    const value = jsonPath(result.json, extraction.path);
    if (value === undefined) throw new Error('Extraction path not found: ' + extraction.path);
    variables[extraction.variable] = value;
  }
  const assigned=new Set([...(pre.assigned||[]),...(post.assigned||[]),...(r.extract||[]).map(value=>value.variable)]);
  const exported={...globalVariables};for(const [key,value] of Object.entries(variables))if(assigned.has(key)||!Object.hasOwn(initialVariables,key)||!isDeepStrictEqual(initialVariables[key],value))exported[key]=value;
  return { ...result, cookies:jar.cookies.map(cookie=>({...cookie})),preResults, tests, logs, variables:options.exportGlobalsOnly?exported:variables, passed: tests.every(t => t.passed) && result.status < 400 };
}
function flatten(collection, inherited = {}) {
  const requests = [];
  function merge(base, item) {
    return { ...base, ...item, headers: Object.fromEntries([...pairs(base.headers), ...pairs(item.headers)]), preScript: [base.preScript, item.preScript].filter(Boolean).join('\n'), postScript: [base.postScript, item.postScript].filter(Boolean).join('\n') };
  }
  const defaults = merge(inherited, collection.defaults || {});
  for (const r of collection.requests || []) requests.push(merge(defaults, r));
  for (const folder of collection.folders || []) requests.push(...flatten(folder, defaults));
  return requests;
}
function dependencyRequests(request,collections,stack=[]) {
  if(stack.length>10)throw new Error('Pre-request dependency depth limit exceeded');
  const result=[request];
  for(const reference of request.preRequests||[]) {
    if(reference.enabled===false)continue;
    const key=JSON.stringify([reference.collectionId,reference.requestId]);if(stack.includes(key))throw new Error('Pre-request dependency cycle');
    const collection=(collections||[]).find(c=>(c.id||c.name)===reference.collectionId);
    const child=collection&&flatten(collection).find(r=>(r.id||r.name)===reference.requestId);
    if(!child)throw new Error('Pre-request not found in the selected collection');
    result.push(...dependencyRequests({...child,variables:collection.variables},collections,[...stack,key]));
    if(result.length>100)throw new Error('Pre-request execution limit exceeded');
  }
  return result;
}
async function runCollection(collection, options = {}) {
  if (collection.version !== 1) throw new Error('Unsupported collection version');
  let variables = { ...options.variables }; const results = []; const jar = new CookieJar();
  for (const request of flatten(collection)) {
    if (options.signal?.aborted) break;
    try { const result = await execute(request, { ...options, variables, jar,collectionVariables:collection.variables,exportGlobalsOnly:true,collections:options.collections||[collection] }); variables = result.variables; results.push({ name: request.name || request.url, ...result }); }
    catch (e) { results.push({ name: request.name || request.url, passed: false, error: e.message, tests: [] }); }
  }
  return { passed: results.length > 0 && results.every(r => r.passed) && !options.signal?.aborted, results, variables:{...collection.variables,...variables} };
}
module.exports = { execute, runCollection, substitute, assertions, CookieJar, flatten,dependencyRequests,pairs,requestTemplate,referencedSecrets };
