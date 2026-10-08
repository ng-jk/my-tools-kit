// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import {COMMAND_SET_PROFILE} from '../../../data/sftp/constants';
import {showInformationMessage} from '../host';
import {getAllFileService, selectServiceProfile} from '../modules/serviceManager/index';
import {checkCommand} from './abstract/createCommand';

export default checkCommand({
  id: COMMAND_SET_PROFILE,
  async handleCommand(definedProfile) {
    const services=getAllFileService().filter(service=>service.getAvailableProfiles().length);
    if(!services.length){showInformationMessage('No available profiles.');return;}
    let service=services[0];
    if(services.length>1){
      const selected=await vscode.window.showQuickPick(services.map(item=>({label:item.name || item.baseDir,description:item.workspace,detail:item.baseDir,service:item})),{placeHolder:'Choose the configuration whose profile will change'});
      if(!selected)return;
      service=selected.service;
    }
    let profile:string|null;
    if(definedProfile!==undefined){
      if(definedProfile!==null&&!service.getAvailableProfiles().includes(definedProfile)) throw new Error('Unknown profile for the selected configuration');
      profile=definedProfile;
    }else{
      const choices=[{value:null as string|null,label:'UNSET (base configuration)'},...service.getAvailableProfiles().map(value=>({value,label:service.profile===value?value+' (active)':value}))];
      const selected=await vscode.window.showQuickPick(choices,{placeHolder:'Choose a profile for '+(service.name || service.baseDir)});
      if(!selected)return;
      profile=selected.value;
    }
    selectServiceProfile(service,profile);
  }
});
