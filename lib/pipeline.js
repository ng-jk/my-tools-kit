'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { inside, readJson, hash, writeAtomic } = require('./files');

const WORKFLOW = '.github/workflows/devkit.yml';
const STATE = '.devkit/pipeline-state.json';
const CHECKOUT = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'; // v4.2.2
const SETUP_NODE = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'; // v4.4.0
const exists = (root, file) => fs.existsSync(inside(root, file));
const content = (root, file) => exists(root, file) ? fs.readFileSync(inside(root, file), 'utf8') : null;

function inspect(root) {
  root = fs.realpathSync(root);
  const findings = [], projects = [], inputs = {};
  const read = file => { const text = content(root, file); inputs[file] = text === null ? null : hash(text); return text; };
  const pkgText = read('package.json');
  const composerText = read('composer.json');
  const requirements = read('requirements.txt');
  const pyproject = read('pyproject.toml');
  const configText = read('.devkit-pipeline.json');
  const config = configText ? JSON.parse(configText) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('.devkit-pipeline.json must be an object');
  for (const key of Object.keys(config)) if (!['nodeVersion', 'pythonTest', 'deploy'].includes(key)) throw new Error('Unsupported pipeline option: ' + key);
  const locks = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].filter(file => read(file) !== null);
  if (pkgText) {
    const pkg = JSON.parse(pkgText); const scripts = pkg.scripts || {};
    const supported = locks.filter(l => ['package-lock.json', 'npm-shrinkwrap.json'].includes(l));
    if (locks.length > 1) findings.push({ severity: 'error', message: 'Multiple Node lockfiles: select one package manager before configuring CI.' });
    if (locks.length === 1 && !supported.length) findings.push({ severity: 'error', message: 'Only npm projects are supported automatically; add a custom job for this package manager.' });
    const steps = [{ name: 'Install dependencies', run: supported.length ? 'npm ci' : 'npm install' }];
    if (!locks.length) findings.push({ severity: 'warning', message: 'No Node lockfile: CI uses npm install. Commit a lockfile for reproducibility.' });
    for (const name of ['lint', 'check', 'test', 'build']) if (typeof scripts[name] === 'string') {
      if (name === 'test' && scripts[name].includes('no test specified')) { findings.push({ severity: 'warning', message: 'Placeholder npm test script omitted.' }); continue; }
      steps.push({ name, run: `npm run ${name}` });
    }
    if (steps.length === 1) findings.push({ severity: 'warning', message: 'No lint, check, test, or build scripts found in package.json.' });
    const node = config.nodeVersion || '22';
    if (!/^\d+(?:\.\d+){0,2}$/.test(node)) throw new Error('nodeVersion must be a numeric version string');
    projects.push({ id: 'node', evidence: 'package.json', steps: [{ uses: SETUP_NODE, with: { 'node-version': node, ...(supported.length ? { cache: 'npm' } : {}) } }, ...steps] });
  }
  if (requirements !== null || pyproject !== null) {
    const install = requirements !== null ? 'python3 -m pip install -r requirements.txt' : 'python3 -m pip install .';
    const steps = [{ name: 'Create Python environment', run: 'python3 -m venv .venv\necho "$PWD/.venv/bin" >> "$GITHUB_PATH"' }, { name: 'Install dependencies', run: install }];
    if (config.pythonTest) {
      if (typeof config.pythonTest !== 'string' || !config.pythonTest.trim()) throw new Error('pythonTest must be a command');
      steps.push({ name: 'Test', run: config.pythonTest });
    } else findings.push({ severity: 'warning', message: 'Set pythonTest in .devkit-pipeline.json to the verified Python test command; no test framework is guessed.' });
    projects.push({ id: 'python', evidence: requirements !== null ? 'requirements.txt' : 'pyproject.toml', steps });
  }
  if (composerText) {
    read('composer.lock'); const composer = JSON.parse(composerText);
    const steps = [{ name: 'Install PHP dependencies', run: 'php --version\ncomposer install --no-interaction --prefer-dist' }];
    for (const name of ['lint', 'test', 'build']) if (composer.scripts?.[name]) steps.push({ name, run: `composer run-script ${name}` });
    projects.push({ id: 'php', evidence: 'composer.json', steps });
  }
  if (!projects.length) findings.push({ severity: 'error', message: 'No supported root manifest found. Select a directory containing package.json, composer.json, requirements.txt, or pyproject.toml.' });
  const workflowDir = inside(root, '.github/workflows');
  const workflows = fs.existsSync(workflowDir) ? fs.readdirSync(workflowDir).filter(x => /\.ya?ml$/.test(x)) : [];
  if (workflows.some(x => x !== 'devkit.yml')) findings.push({ severity: 'warning', message: 'Existing workflows are preserved; review duplicate CI jobs before enabling this additional workflow.' });
  return { root, config, projects, findings, inputs, workflows };
}
function workflow(info) {
  const jobs = {};
  for (const project of info.projects) jobs['devkit-' + project.id] = { 'runs-on': 'ubuntu-24.04', 'timeout-minutes': 20, steps: [{ uses: CHECKOUT, with: { 'persist-credentials': false } }, ...project.steps] };
  const deploy = info.config.deploy;
  if (deploy) {
    if (typeof deploy.command !== 'string' || !deploy.command.trim() || !/^[\w.-]+$/.test(deploy.environment || '')) throw new Error('deploy requires command and an environment name');
    const env = {};
    for (const [key, secret] of Object.entries(deploy.secrets || {})) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || !/^[A-Z_][A-Z0-9_]*$/.test(secret)) throw new Error('Deployment secret references must be uppercase identifiers');
      env[key] = '${{ secrets.' + secret + ' }}';
    }
    jobs['devkit-deploy'] = {
      if: "github.event_name == 'workflow_dispatch' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
      needs: Object.keys(jobs), 'runs-on': 'ubuntu-24.04', 'timeout-minutes': 20,
      environment: deploy.environment,
      steps: [{ uses: CHECKOUT, with: { 'persist-credentials': false } }, { name: 'Deploy', env, run: deploy.command }]
    };
  }
  return { name: 'Development Tools Kit', on: { push: {}, pull_request: {}, workflow_dispatch: {} }, permissions: { contents: 'read' }, concurrency: { group: 'devkit-${{ github.workflow }}-${{ github.ref }}', 'cancel-in-progress': true }, jobs };
}
function runtimeFiles() {
  const source = path.resolve(__dirname, '..');
  return ['pipeline-cli.js', 'lib/files.js', 'lib/pipeline.js', 'skills/configure-pipeline/SKILL.md'].map(file => ({ path: file, text: fs.readFileSync(path.join(source, file), 'utf8') }));
}
function plan(root, options = {}) {
  const info = inspect(root);
  if (info.findings.some(f => f.severity === 'error')) return { version: 1, root: info.root, inputs: info.inputs, findings: info.findings, files: [] };
  const files = [{ path: WORKFLOW, after: JSON.stringify(workflow(info), null, 2) + '\n' }];
  const agents = [...new Set(options.agents || [])];
  for (const host of agents) {
    if (!['codex', 'claude'].includes(host)) throw new Error('Unknown agent host: ' + host);
    const dir = (host === 'codex' ? '.agents' : '.claude') + '/skills/configure-pipeline';
    files.push({ path: dir + '/SKILL.md', after: fs.readFileSync(path.resolve(__dirname, '../skills/configure-pipeline/SKILL.md'), 'utf8') });
    for (const item of runtimeFiles()) files.push({ path: dir + '/scripts/runtime/' + item.path, after: item.text });
  }
  const state = exists(root, STATE) ? readJson(inside(root, STATE)) : { files: {} };
  for (const file of files) {
    file.before = content(root, file.path); file.beforeHash = file.before === null ? null : hash(file.before);
    file.changed = file.before !== file.after;
    if (file.changed && file.before !== null && state.files[file.path]?.afterHash !== file.beforeHash) info.findings.push({ severity: 'error', message: `Conflict: ${file.path} is not an unchanged managed file. Preserve it and resolve manually.` });
  }
  return { version: 1, root: info.root, inputs: info.inputs, options: { agents }, findings: info.findings, files };
}
function apply(root, proposed) {
  if (proposed.version !== 1 || fs.realpathSync(root) !== proposed.root) throw new Error('Plan belongs to a different project');
  const fresh = plan(root, proposed.options);
  if (JSON.stringify(fresh) !== JSON.stringify(proposed)) throw new Error('Plan is stale or modified. Generate a fresh plan.');
  if (fresh.findings.some(f => f.severity === 'error')) throw new Error(fresh.findings.filter(f => f.severity === 'error').map(f => f.message).join('\n'));
  const stateFile = inside(root, STATE);
  const prior = fs.existsSync(stateFile) ? readJson(stateFile) : { version: 1, files: {} };
  const next = structuredClone(prior); const written = [];
  try {
    for (const file of fresh.files.filter(f => f.changed)) {
      const target = inside(root, file.path);
      if (content(root, file.path) !== file.before) throw new Error('File changed during apply: ' + file.path);
      writeAtomic(target, file.after); written.push(file);
      next.files[file.path] = { original: prior.files[file.path] ? prior.files[file.path].original : file.before, afterHash: hash(file.after) };
    }
    if (written.length) writeAtomic(stateFile, JSON.stringify(next, null, 2) + '\n');
  } catch (e) {
    for (const file of written.reverse()) { const target = inside(root, file.path); if (file.before === null) fs.unlinkSync(target); else writeAtomic(target, file.before); }
    throw e;
  }
  return { changed: written.map(f => f.path), findings: fresh.findings };
}
function rollback(root) {
  const stateFile = inside(root, STATE);
  if (!fs.existsSync(stateFile)) return { restored: [] };
  const state = readJson(stateFile);
  for (const [file, record] of Object.entries(state.files)) if (hash(content(root, file) ?? '') !== record.afterHash) throw new Error('Rollback conflict: ' + file);
  const restored = [];
  for (const [file, record] of Object.entries(state.files)) {
    const target = inside(root, file);
    if (record.original === null) fs.unlinkSync(target); else writeAtomic(target, record.original);
    restored.push(file);
  }
  fs.unlinkSync(stateFile); return { restored };
}
function check(root) {
  const info = inspect(root); const findings = [...info.findings];
  const text = content(root, WORKFLOW);
  if (text === null) findings.push({ severity: 'error', message: 'Managed workflow does not exist' });
  else {
    try {
      const data = JSON.parse(text);
      if (!data.jobs || !Object.keys(data.jobs).length || !data.on || data.permissions?.contents !== 'read') throw new Error('Invalid workflow structure');
      if (JSON.stringify(data) !== JSON.stringify(workflow(info))) findings.push({ severity: 'error', message: 'Workflow differs from current repository configuration; regenerate the plan.' });
    } catch (e) { findings.push({ severity: 'error', message: e.message }); }
  }
  return { passed: !findings.some(f => f.severity === 'error'), findings };
}
module.exports = { inspect, plan, apply, rollback, check, WORKFLOW };
