import * as vscode from 'vscode';
import {checkCommand} from './abstract/createCommand';
import {getAllFileService} from '../modules/serviceManager/index';
import {inspectServerIsolation} from '../../../logic/sftp/parent-directories';

export default checkCommand({
  id:'devkit.sftp.checkIsolation',
  async handleCommand(){
    const choices=getAllFileService().map(service=>({label:service.name||service.baseDir,description:service.profile||'base',service}));
    if(!choices.length){vscode.window.showInformationMessage('Configure an FTP/SFTP connection first.');return;}
    const selected=choices.length===1?choices[0]:await vscode.window.showQuickPick(choices,{placeHolder:'Select the context/profile to inspect (read only)'});
    if(!selected)return;
    const service=selected.service,config=service.getConfig(),fs=await service.getRemoteFileSystem(config);
    const report=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Checking server isolation',cancellable:false},()=>inspectServerIsolation(fs,config.remotePath));
    const document=await vscode.workspace.openTextDocument({language:'plaintext',content:[report.passed?'Protected directory metadata checks passed':'Server isolation checks did not pass','Remote root: '+report.root,report.message,'Jail verification: '+report.jail,'No files or server settings were changed.','Setup and no-admin guidance: https://github.com/ng-jk/my-tools-kit/blob/developement/docs/server-isolation.md'].join('\n\n')});
    await vscode.window.showTextDocument(document,{preview:true});
  }
});
