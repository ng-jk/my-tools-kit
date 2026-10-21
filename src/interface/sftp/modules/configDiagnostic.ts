import * as path from 'path';
import {getWorkspaceFolders} from '../host';
import {CONFIG_PATH} from '../../../data/sftp/constants';
import {inspectConfiguration} from '../../../data/sftp-config';
import {normalizeConfigurations,validateConfig} from '../../../logic/sftp/config';
import {getAllFileService} from './serviceManager';

export function missingContextError(uri:any):Error {
  if(uri.scheme!=='file') return new Error('The remote connection or context is no longer active. Refresh the Remote Explorer and select the file again.');
  const file=uri.fsPath;
  const folders=(getWorkspaceFolders()||[]).filter(folder=>{
    const relative=path.relative(folder.uri.fsPath,file);
    return relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);
  }).sort((a,b)=>b.uri.fsPath.length-a.uri.fsPath.length);
  if(!folders.length)return new Error('Local file is outside all open workspaces: '+file+'. Open its project folder and configure its SFTP context.');
  const configPath=path.join(folders[0].uri.fsPath,CONFIG_PATH);
  const inspection=inspectConfiguration(configPath);
  if(inspection.problem)return new Error(inspection.problem+': '+configPath);
  try {
    const configs=normalizeConfigurations(inspection.value,process.env);
    if(!configs.length)return new Error('No connections are configured in '+configPath);
    for(const raw of configs) {
      if(raw.defaultProfile&&!raw.profiles?.[raw.defaultProfile])return new Error('The selected defaultProfile does not exist in profiles: '+configPath+'. Select an existing profile.');
      const config=raw.defaultProfile?{...raw,...raw.profiles?.[raw.defaultProfile]}:raw;
      const failure=validateConfig(config);
      if(failure)return new Error('Invalid SFTP settings in '+configPath+': '+failure.details.map(detail=>String(detail.path)+ ' ('+detail.type+')').join(', ')+'. Correct the indicated fields.');
    }
  }catch(error){return new Error('Cannot load SFTP settings in '+configPath+': '+error.message);}
  const contexts=getAllFileService().filter(service=>service.workspace===folders[0].uri.fsPath).map(service=>service.baseDir);
  return new Error(contexts.length?'Local file is outside the active SFTP contexts: '+file+'. Active local roots: '+contexts.join(', ')+'. Select the correct context or correct its local path.':'SFTP settings exist but no connection context is loaded for '+file+'. Save '+configPath+' to reload; check the SFTP output for the preceding load error.');
}
