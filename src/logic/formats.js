'use strict';
const { randomUUID } = require('node:crypto');
const { flatten } = require('./api');
function importCollection(data) {
  if (data.version === 1 && Array.isArray(data.requests)) return { collection: data, warnings: [] };
  const warnings = [];
  const collection = { version: 1, name: data.info?.name || data.collectionName || 'Imported collection', variables: {}, requests: [] };
  const mapPairs = pairs => Object.fromEntries((pairs || []).filter(v => !v.disabled && v.isDisabled !== true).map(v => [v.key ?? v.name, v.value ?? '']));
  if (data.info && Array.isArray(data.item)) {
    for (const variable of data.variable || []) collection.variables[variable.key] = variable.value;
    function walk(items, folder = '') {
      for (const item of items) {
        if (item.item) { walk(item.item, folder + item.name + '/'); continue; }
        const raw = typeof item.request === 'string' ? { url: item.request } : item.request;
        const r = { id: randomUUID(), name: folder + item.name, url: typeof raw.url === 'string' ? raw.url : raw.url?.raw, method: raw.method || 'GET', headers: mapPairs(raw.header) };
        if (!r.url) throw new Error('Postman request has no raw URL: ' + r.name);
        if (raw.body?.mode === 'raw') r.body = { type: raw.body.options?.raw?.language === 'json' ? 'json' : 'text', value: raw.body.raw };
        else if (raw.body?.mode === 'urlencoded') r.body = { type: 'form', value: mapPairs(raw.body.urlencoded) };
        else if (raw.body) warnings.push(r.name + ': multipart/file body requires manual mapping.');
        const auth = raw.auth || data.auth;
        if (auth?.type === 'bearer') r.auth = { type: 'bearer', token: mapPairs(auth.bearer).token };
        else if (auth?.type === 'basic') r.auth = { type: 'basic', ...mapPairs(auth.basic) };
        else if (auth && auth.type !== 'noauth') warnings.push(r.name + ': authentication requires manual mapping.');
        if (item.event?.length || data.event?.length) warnings.push(r.name + ': Postman scripts are not automatically translated.');
        collection.requests.push(r);
      }
    }
    walk(data.item);
  } else if (Array.isArray(data.requests) && data.client === 'Thunder Client') {
    for (const raw of data.requests) {
      const r = { id: randomUUID(), name: raw.name, method: raw.method, url: raw.url, headers: mapPairs(raw.headers), query: mapPairs(raw.params) };
      if (raw.body?.raw) r.body = { type: raw.body.type === 'json' ? 'json' : 'text', value: raw.body.raw };
      if (raw.auth || raw.tests?.length || raw.preReq || raw.postReq) warnings.push(raw.name + ': map authentication, assertions, and scripts manually before use.');
      collection.requests.push(r);
    }
  } else if (data.openapi?.startsWith('3.') && data.paths) {
    collection.name = data.info?.title || 'OpenAPI'; collection.variables.baseUrl = data.servers?.[0]?.url || 'http://localhost:3000';
    for (const [route, methods] of Object.entries(data.paths)) for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(method)) continue;
      collection.requests.push({ id: randomUUID(), name: operation.summary || `${method.toUpperCase()} ${route}`, method: method.toUpperCase(), url: '{{baseUrl}}' + route.replace(/\{([^}]+)\}/g, '{{$1}}') });
    }
    warnings.push('OpenAPI import creates endpoint skeletons. Map path variables, request bodies, parameters, security, and references before use.');
  } else throw new Error('Supported formats: DevKit v1, Postman v2 JSON, Thunder Client JSON, OpenAPI 3 JSON');
  return { collection, warnings };
}
const shQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function curl(request) {
  const args = ['curl', '-X', shQuote(request.method || 'GET'), shQuote(request.url)];
  for (const [key, value] of Object.entries(request.headers || {})) args.push('-H', shQuote(key + ': ' + value));
  if (request.body?.value !== undefined) args.push('--data-raw', shQuote(typeof request.body.value === 'string' ? request.body.value : JSON.stringify(request.body.value)));
  return args.join(' ');
}
function exportPostman(collection) {
  const warnings = ['Export includes request URL, method, headers and raw bodies only; auth, variables, assertions and scripts need manual mapping.'];
  return { warnings, data: { info: { name: collection.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: flatten(collection).map(r => ({ name: r.name, request: { method: r.method || 'GET', url: r.url, header: Object.entries(r.headers || {}).map(([key, value]) => ({ key, value })), ...(r.body ? { body: { mode: 'raw', raw: typeof r.body.value === 'string' ? r.body.value : JSON.stringify(r.body.value) } } : {}) } })) } };
}
module.exports = { importCollection, exportPostman, curl };
