'use strict';
const path = require('node:path');
const {readJson} = require('../data/files');
async function configurePipeline(vscode, context, root) {
  const configPath = path.join(root, '.devkit-pipeline.json');
  let config, configurationError;
  try {
    config = readJson(configPath);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Expected object');
  } catch (error) {
    configurationError = error.code === 'ENOENT' ? 'missing' : 'invalid';
    config = {};
  }
  const mode = config.interfaceReview || 'human';
  const acceptance = mode === 'ai-ux'
    ? { label: 'Review UI/UX and release', command: 'release', description: 'Run tests, code and UI/UX reviews, then publish and promote on success' }
    : { label: config.autoPublishAfterUat ? 'Approve interface and finish release' : 'Record interface acceptance', command: 'accept-uat', description: config.autoPublishAfterUat ? 'Record actual human acceptance, then publish on success' : 'Record actual human acceptance; use Publish separately to release' };
  const recovery = [
    { label: configurationError === 'missing' ? 'Create pipeline configuration' : 'Repair pipeline configuration', command: 'edit-config', description: 'Edit .devkit-pipeline.json; configure your own test and build commands using the setup guide' },
    { label: 'Pipeline setup guide', command: 'setup-guide', description: 'Configuration examples and CLI usage' },
    { label: 'Status', command: 'status', description: 'Run CLI diagnostics for the project configuration' }
  ];
  const action = await vscode.window.showQuickPick(configurationError ? recovery : [
    { label: 'Status', command: 'status', description: 'Show branches, reviewer, and evidence location' },
    { label: 'Verify Marketplace access', command: 'marketplace-check', description: 'Read-only vsce check using Microsoft Entra ID' },
    { label: 'Initialize branches', command: 'init', description: 'Create missing developement, test, deployment branches from main' },
    { label: 'Check current changes', command: 'check', description: 'Architecture, unit, function, integration tests and package build' },
    { label: 'Test committed development', command: 'test', description: 'Advance test and run isolated checks plus AI review' },
    { label: 'Test and push test branch', command: 'test', flags: ['--push'], description: 'Also fast-forward the remote test branch' },
    acceptance,
    { label: 'Publish', command: 'publish', description: 'Check deployment, publish approved VSIX if configured, then advance main' }
  ], { title: 'Development Tools Kit — Python CI/CD', placeHolder: configurationError ? `.devkit-pipeline.json is ${configurationError}. Create or repair it before running the pipeline.` : 'Choose a pipeline action' });
  if (!action) return;
  if (action.command === 'edit-config') {
    const uri = vscode.Uri.file(configPath);
    const document = await vscode.workspace.openTextDocument(configurationError === 'missing' ? uri.with({scheme:'untitled'}) : uri);
    await vscode.window.showTextDocument(document);
    return;
  }
  if (action.command === 'setup-guide') {
    await vscode.env.openExternal(vscode.Uri.parse('https://github.com/ng-jk/my-tools-kit/blob/main/docs/pipeline-usage.md'));
    return;
  }
  const args = [path.join(context.extensionPath, 'pipeline.py'), '--root', root, action.command, ...(action.flags || [])];
  if (action.command === 'accept-uat') {
    for (const [flag, prompt] of [['--commit', 'Exact commit you tested'], ['--reviewer', 'Your name'], ['--note', 'Interface acceptance checks you completed']]) {
      const value = await vscode.window.showInputBox({ prompt, validateInput: v => v.trim() ? undefined : 'Required' });
      if (!value) return;
      args.push(flag, value);
    }
  }
  const python = vscode.workspace.getConfiguration('devkit').get('pythonPath') || process.env.DEVKIT_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
  if (python === 'py') args.unshift('-3');
  const task = new vscode.Task({ type: 'devkit', command: action.command }, vscode.TaskScope.Workspace,
    'Pipeline: ' + action.label, 'Development Tools Kit', new vscode.ProcessExecution(python, args, { cwd: root }), []);
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.New };
  await vscode.tasks.executeTask(task);
}
module.exports = { configurePipeline };
