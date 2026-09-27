'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const p = require('../lib/pipeline');
function fixture(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-pipeline-'));
  try { for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), typeof text === 'string' ? text : JSON.stringify(text)); } return fn(root); }
  finally { fs.rmSync(root, { recursive: true }); }
}
const node = { 'package.json': { scripts: { test: 'node --test', build: 'node build.js' } }, 'package-lock.json': { lockfileVersion: 3 } };
test('Node CI configuration is idempotent and leaves custom workflows intact', () => fixture({ ...node, '.github/workflows/custom.yml': 'name: custom\n' }, root => {
  const plan = p.plan(root); assert.equal(plan.files.length, 1); p.apply(root, plan);
  assert.equal(p.check(root).passed, true); assert.equal(p.plan(root).files[0].changed, false); assert.deepEqual(p.apply(root, p.plan(root)).changed, []);
  const workflow = JSON.parse(fs.readFileSync(path.join(root, p.WORKFLOW)));
  assert.equal(workflow.jobs['devkit-node'].steps[2].run, 'npm ci');
  assert.equal(fs.readFileSync(path.join(root, '.github/workflows/custom.yml'), 'utf8'), 'name: custom\n');
}));
test('stale and tampered plans cannot be applied', () => fixture(node, root => {
  const plan = p.plan(root); plan.files[0].after = '{}'; assert.throws(() => p.apply(root, plan), /stale or modified/);
  const fresh = p.plan(root); fs.writeFileSync(path.join(root, 'package.json'), '{}'); assert.throws(() => p.apply(root, fresh), /stale or modified/);
}));
test('user edits are preserved both during reconfiguration and rollback', () => fixture(node, root => {
  p.apply(root, p.plan(root)); const target = path.join(root, p.WORKFLOW); fs.appendFileSync(target, '\n# user change');
  assert.throws(() => p.apply(root, p.plan(root)), /Conflict/); assert.throws(() => p.rollback(root), /conflict/); assert.match(fs.readFileSync(target, 'utf8'), /user change/);
}));
test('rollback after multiple configurations restores original absent state', () => fixture(node, root => {
  p.apply(root, p.plan(root)); fs.writeFileSync(path.join(root, '.devkit-pipeline.json'), '{"nodeVersion":"24"}');
  p.apply(root, p.plan(root)); p.rollback(root); assert.equal(fs.existsSync(path.join(root, p.WORKFLOW)), false);
}));
test('ambiguous package managers and unsupported roots have actionable findings', () => fixture({ ...node, 'yarn.lock': '' }, root => {
  const plan = p.plan(root); assert.equal(plan.files.length, 0); assert.match(plan.findings[0].message, /Multiple/);
  assert.throws(() => p.apply(root, plan), /Multiple/);
}));
test('Python and PHP use verified commands and explicit deployment secrets', () => fixture({ 'requirements.txt': 'pytest\n', 'composer.json': { scripts: { test: 'phpunit' } }, '.devkit-pipeline.json': { pythonTest: 'python3 -m pytest', deploy: { environment: 'staging', command: './deploy.sh', secrets: { DEPLOY_TOKEN: 'STAGING_TOKEN' } } } }, root => {
  const plan = p.plan(root); p.apply(root, plan); const workflow = JSON.parse(plan.files[0].after);
  assert.equal(workflow.jobs['devkit-python'].steps.at(-1).run, 'python3 -m pytest');
  assert.equal(workflow.jobs['devkit-php'].steps.at(-1).run, 'composer run-script test');
  assert.match(workflow.jobs['devkit-deploy'].if, /workflow_dispatch/); assert.equal(workflow.jobs['devkit-deploy'].steps[1].env.DEPLOY_TOKEN, '${{ secrets.STAGING_TOKEN }}');
}));
test('self-installed agent runtime works outside the toolkit', () => fixture(node, root => {
  p.apply(root, p.plan(root, { agents: ['codex', 'claude'] }));
  for (const host of ['.agents', '.claude']) {
    const runtime = path.join(root, host, 'skills/configure-pipeline/scripts/runtime/pipeline-cli.js');
    const result = spawnSync(process.execPath, [runtime, 'check', root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).passed, true);
  }
}));
