'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');
async function script(source, request, response, variables, options) {
  if (!source?.trim()) return { variables, tests: [], logs: [] };
  if (!options.allowScripts) throw new Error('Scripts require trusted execution (--allow-scripts in CLI)');
  // Worker provides resource/time isolation, not a security sandbox. Only trusted scripts may run.
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'script-worker.js'), {
      workerData: { source, request, response, variables }, resourceLimits: { maxOldGenerationSizeMb: 32 }
    });
    const finish = (err, result) => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); worker.terminate(); err ? reject(err) : resolve(result); };
    const abort = () => finish(new Error('Request cancelled'));
    const timer = setTimeout(() => finish(new Error('Script timeout')), 2000);
    worker.once('message', value => finish(value.error ? new Error(value.error) : null, value));
    worker.once('error', error => finish(error));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}
module.exports = { script };
