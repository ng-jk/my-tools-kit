'use strict';
const http = require('node:http');
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health') res.end(JSON.stringify({ status: 'ok' }));
  else res.end(JSON.stringify({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') }));
});
server.listen(4318, '127.0.0.1', () => console.log('Demo API at http://127.0.0.1:4318. Press Ctrl+C to stop.'));
