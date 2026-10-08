'use strict';
const path = require('node:path');
async function configurePipeline(vscode, context, root) {
  const action = await vscode.window.showQuickPick([
    { label: 'Status', command: 'status', description: 'Show branches, reviewer, and evidence location' },
    { label: 'Verify Marketplace access', command: 'marketplace-check', description: 'Read-only vsce check using Microsoft Entra ID' },
    { label: 'Initialize branches', command: 'init', description: 'Create missing developement, test, deployment branches from main' },
    { label: 'Check current changes', command: 'check', description: 'Architecture, unit, function, integration tests and package build' },
    { label: 'Test committed development', command: 'test', description: 'Advance test and run isolated checks plus AI review' },
    { label: 'Test and push test branch', command: 'test', flags: ['--push'], description: 'Also fast-forward the remote test branch' },
    { label: 'Review UI/UX and release', command: 'release', description: 'Run tests, code and UI/UX reviews, then publish and promote on success' },
    { label: 'Publish', command: 'publish', description: 'Check deployment, publish approved VSIX if configured, then advance main' }
  ], { title: 'Development Tools Kit — Python CI/CD' });
  if (!action) return;
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
