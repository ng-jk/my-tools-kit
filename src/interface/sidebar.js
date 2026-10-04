'use strict';
const tools = [
  ['API Debugger', 'devkit.open', 'request'],
  ['JSON Formatter', 'devkit.jsonFormatter', 'json'],
  ['Compare Text / Files', 'devkit.textTools', 'diff'],
  ['Compare Git Revisions', 'devkit.compareGit', 'git-compare'],
  ['SFTP / FTP', 'devkit.sftp.menu', 'cloud-upload'],
  ['CI/CD Pipeline', 'devkit.pipeline', 'gear']
];
function activateSidebar(vscode, context) {
  const entries = tools.map(([label, command, icon]) => ({ label, command: { command, title: label }, iconPath: new vscode.ThemeIcon(icon), collapsibleState: 0 }));
  context.subscriptions.push(vscode.window.registerTreeDataProvider('devkit.tools', {
    getTreeItem: item => item, getChildren: () => entries
  }));
  context.subscriptions.push(vscode.commands.registerCommand('devkit.sftp.menu', async () => {
    const choices = context.extension.packageJSON.contributes.commands
      .filter(item => item.command.startsWith('devkit.sftp.') && item.command !== 'devkit.sftp.menu')
      .map(item => ({ label: item.title, command: item.command }));
    const selected = await vscode.window.showQuickPick(choices, { title: 'SFTP / FTP — choose a function', matchOnDescription: true });
    if (selected) await vscode.commands.executeCommand(selected.command);
  }));
}
module.exports = { activateSidebar, tools };
