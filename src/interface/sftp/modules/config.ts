// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import * as path from 'path';
import {CONFIG_PATH} from '../../../data/sftp/constants';
import {readConfiguration,ensureConfiguration,configurationExists} from '../../../data/sftp-config';
import {reportError} from '../helper/index';
import {showTextDocument} from '../host';
import {validateConfig,initialConfig,normalizeConfigurations} from '../../../logic/sftp/config';
export {validateConfig};
export async function readConfigsFromFile(configPath:string):Promise<any[]> {
  return normalizeConfigurations(await readConfiguration(configPath),process.env);
}
export async function tryLoadConfigs(workspace:string):Promise<any[]> {
  const configPath=path.join(workspace,CONFIG_PATH);
  return configurationExists(configPath)?readConfigsFromFile(configPath):[];
}
export async function newConfig(basePath:string) {
  const configPath=path.join(basePath,CONFIG_PATH);
  try {await ensureConfiguration(configPath,initialConfig());return showTextDocument(vscode.Uri.file(configPath));}
  catch(error){reportError(error);}
}
