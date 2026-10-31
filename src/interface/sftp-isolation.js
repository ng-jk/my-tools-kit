'use strict';
async function runIsolationCheck(vscode,connections,inspect) {
  if(!connections.length){vscode.window.showInformationMessage('Configure an FTP/SFTP connection first.');return;}
  const choices=connections.map(item=>({...item,
    description:`${item.connection.host}:${item.connection.port} · profile ${item.connection.profile||'base'}`,
    detail:`Workspace: ${item.connection.workspace} | Context: ${item.connection.context} | Remote: ${item.config.remotePath}`
  }));
  const selected=choices.length===1?choices[0]:await vscode.window.showQuickPick(choices,{placeHolder:'Select the workspace/context and server to inspect (read only)'});
  if(!selected)return;
  const {service,config,connection}=selected;
  const report=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`Checking server isolation: ${connection.host}:${connection.port}`,cancellable:false},async()=>{
    const fs=await service.getRemoteFileSystem(config);
    return inspect(fs,config.remotePath,connection);
  });
  const document=await vscode.workspace.openTextDocument({language:'plaintext',content:[
    report.passed?'Protected directory metadata checks passed':'Server isolation checks did not pass',
    `Server: ${connection.host}:${connection.port}`,`Profile: ${connection.profile||'base'}`,
    `Workspace: ${connection.workspace}`,`Context: ${connection.context}`,
    'Remote root: '+report.root,report.message,'Jail verification: '+report.jail,
    'No files or server settings were changed.',
    'Setup and no-admin guidance: https://github.com/ng-jk/my-tools-kit/blob/developement/docs/server-isolation.md'
  ].join('\n\n')});
  await vscode.window.showTextDocument(document,{preview:true});
}
module.exports={runIsolationCheck};
