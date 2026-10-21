'use strict';
const http = require('node:http');
const https = require('node:https');
function transport(url, init, options) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
    if (!client) return reject(new Error('Only HTTP and HTTPS URLs are supported'));
    if (url.username || url.password) return reject(new Error('Use the authentication fields instead of URL credentials'));
    const req = client.request(url, { method: init.method, headers: init.headers, signal: options.signal, ...init.tls,agent:options.agent }, res => {
      const socket=res.socket;
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > (options.maxBytes || 10 * 1024 * 1024)) { res.destroy(new Error('Response exceeds size limit')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks), size,socket }));
    });
    if(options.expectedSocket)req.on('socket',socket=>{if(socket!==options.expectedSocket)req.destroy(new Error('NTLM server closed the authenticated connection; request not sent on a different socket'));});
    const timer = setTimeout(() => req.destroy(new Error('Request timeout')), options.timeout || 30000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
module.exports = { transport };
