import * as path from 'path';
import FileService from './core/fileService';
import {normalizeConfigurations,validateConfig} from './config';
import {resolveProfileContext} from './core/profileContext';

// Data adapters supply a parsed snapshot. Resolve it using the same service as
// transfers; no connection, watcher, registration or VS Code dependency exists.
export function configurationProblem(configPath:string,workspace:string,inspection:any,environment:any):Error|undefined {
  if(inspection.problem)return new Error(inspection.problem+': '+configPath);
  try {
    const configs=normalizeConfigurations(inspection.value,environment);
    if(!configs.length)return new Error('No connections are configured in '+configPath);
    for(const raw of configs) {
      if(raw.defaultProfile&&!raw.profiles?.[raw.defaultProfile])return new Error('The selected defaultProfile does not exist in profiles: '+configPath+'. Select an existing profile.');
      const selected=raw.defaultProfile||null;
      const service=new FileService(path.resolve(workspace,resolveProfileContext(raw,selected)||'.'),workspace,raw,selected);
      try {service.setConfigValidator(validateConfig);service.getConfig();}
      finally {service.dispose();}
    }
  }catch(error){return new Error('Cannot load SFTP settings in '+configPath+': '+error.message);}
}
