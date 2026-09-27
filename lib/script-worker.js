'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
  const tests = [], pending = [], logs = [], variables = workerData.variables;
  const context = vm.createContext({
    request: workerData.request, response: workerData.response,
    env: { get: key => variables[key], set: (key, value) => { variables[key] = value; } },
    test: (name, fn) => {
      const record = { name, passed: false }; tests.push(record);
      pending.push(Promise.resolve().then(fn).then(() => { record.passed = true; }, e => { record.error = e.message; }));
    },
    assert: (value, message) => assert.ok(value, message),
    console: { log: (...args) => logs.push(args.map(String).join(' ')) },
    URL, URLSearchParams
  });
  await new vm.Script('(async () => {\n' + workerData.source + '\n})()').runInContext(context, { timeout: 1000 });
  await Promise.all(pending);
  parentPort.postMessage({ variables, tests, logs });
})().catch(e => parentPort.postMessage({ error: e.message }));
