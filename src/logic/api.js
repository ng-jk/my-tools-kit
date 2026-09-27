'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { inside, readBuffer } = require('../data/files');
const { transport } = require('../data/http');
const { script } = require('../data/scripts');

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
  return Array.isArray(value) ? value.filter(x => x.enabled !== false && x.disabled !== true).map(x => [x.name ?? x.key, x.value ?? '']) : Object.entries(value || {});
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
  if (body.type === 'form') { headers['content-type'] ||= 'application/x-www-form-urlencoded'; return Buffer.from(new URLSearchParams(pairs(body.value)).toString()); }
  if (body.type === 'binary') return readBuffer(inside(root, body.file));
  if (body.type === 'multipart') {
    const boundary = 'devkit-' + crypto.randomUUID(); headers['content-type'] = 'multipart/form-data; boundary=' + boundary;
    const chunks = [];
    for (const field of body.fields || []) {
      if (/[\r\n"]/.test(field.name)) throw new Error('Invalid multipart field name');
      let disposition = `Content-Disposition: form-data; name="${field.name}"`;
      let value = Buffer.from(String(field.value ?? ''));
      if (field.file) {
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
  const start = performance.now(); const root = options.root || process.cwd();
  let variables = { ...options.variables }; const tests = [], logs = [];
  const pre = await script(request.preScript, request, null, variables, options); variables = pre.variables; tests.push(...pre.tests); logs.push(...pre.logs);
  const r = substitute({ ...request, preScript: undefined, postScript: undefined }, variables);
  let url = new URL(r.url); for (const [k, v] of pairs(r.query)) url.searchParams.append(k, v);
  let headers = Object.fromEntries(pairs(r.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  headers['accept-encoding'] = 'identity';
  const auth = r.auth || {};
  if (auth.type === 'basic') headers.authorization = 'Basic ' + Buffer.from(`${auth.username || ''}:${auth.password || ''}`).toString('base64');
  else if (auth.type === 'bearer') headers.authorization = 'Bearer ' + auth.token;
  else if (auth.type === 'apiKey') { if (auth.in === 'query') url.searchParams.set(auth.name, auth.value); else headers[auth.name.toLowerCase()] = auth.value; }
  else if (auth.type === 'oauth2') {
    const token = await execute({ url: auth.tokenUrl, method: 'POST', auth: { type: 'basic', username: auth.clientId, password: auth.clientSecret }, body: { type: 'form', value: { grant_type: 'client_credentials', ...(auth.scope ? { scope: auth.scope } : {}) } } }, { ...options, allowScripts: false });
    if (token.status >= 400 || !token.json?.access_token) throw new Error('OAuth token request failed');
    headers.authorization = 'Bearer ' + token.json.access_token;
  } else if (auth.type && auth.type !== 'none') throw new Error('Unsupported authentication type: ' + auth.type);
  let method = (r.method || 'GET').toUpperCase();
  let body = buildBody(r.body, headers, root);
  const tls = {};
  for (const key of ['ca', 'cert', 'key']) if (r.tls?.[key]) tls[key] = readBuffer(inside(root, r.tls[key]));
  if (r.tls?.passphrase) tls.passphrase = r.tls.passphrase;
  const jar = options.jar || new CookieJar(); let response;
  for (let redirects = 0; ; redirects++) {
    const outgoing = { ...headers }; const cookie = jar.get(url); if (cookie && !outgoing.cookie) outgoing.cookie = cookie;
    response = await transport(url, { method, headers: outgoing, body, tls }, { ...options, timeout: r.timeout || options.timeout });
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
  return { ...result, tests, logs, variables, passed: tests.every(t => t.passed) && result.status < 400 };
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
async function runCollection(collection, options = {}) {
  if (collection.version !== 1) throw new Error('Unsupported collection version');
  let variables = { ...collection.variables, ...options.variables }; const results = []; const jar = new CookieJar();
  for (const request of flatten(collection)) {
    if (options.signal?.aborted) break;
    try { const result = await execute(request, { ...options, variables, jar }); variables = result.variables; results.push({ name: request.name || request.url, ...result }); }
    catch (e) { results.push({ name: request.name || request.url, passed: false, error: e.message, tests: [] }); }
  }
  return { passed: results.length > 0 && results.every(r => r.passed) && !options.signal?.aborted, results, variables };
}
module.exports = { execute, runCollection, substitute, assertions, CookieJar, flatten };
