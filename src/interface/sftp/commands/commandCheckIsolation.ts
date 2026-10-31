import * as vscode from 'vscode';
import {checkCommand} from './abstract/createCommand';
import {getAllFileService} from '../modules/serviceManager/index';
import {inspectServerIsolation,isolationConnection} from '../../../logic/sftp/parent-directories';
import {runIsolationCheck} from '../../sftp-isolation';

export default checkCommand({
  id:'devkit.sftp.checkIsolation',
  async handleCommand(){
    const connections=getAllFileService().map(service=>{
      const config=service.getConfig();
      return {label:service.name||service.baseDir,service,config,connection:isolationConnection(service,config)};
    });
    await runIsolationCheck(vscode,connections,inspectServerIsolation);
  }
});
