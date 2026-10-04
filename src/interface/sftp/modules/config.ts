// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as Joi from 'joi';
import { CONFIG_PATH } from '../../../data/sftp/constants';
import { reportError } from '../helper/index';
import { showTextDocument } from '../host';

import { mergedDefault, validateConfig, initialConfig } from '../../../logic/sftp/config';
export { validateConfig };
function getConfigPath(basePath: string) { return path.join(basePath, CONFIG_PATH); }

export function readConfigsFromFile(configPath: string): Promise<any[]> {
  return fse.readJson(configPath).then((config: any) => {
    const configs = Array.isArray(config) ? config : [config];
    return configs.map(mergedDefault);
  });
}

export function tryLoadConfigs(workspace: string): Promise<any[]> {
  const configPath = getConfigPath(workspace);
  return fse.pathExists(configPath).then(
    (exist: boolean) => {
      if (exist) {
        return readConfigsFromFile(configPath);
      }
      return [];
    },
    _ => []
  );
}

// export function getConfig(activityPath: string) {
//   const config = configTrie.findPrefix(normalizePath(activityPath));
//   if (!config) {
//     throw new Error(`(${activityPath}) config file not found`);
//   }

//   return normalizeConfig(config);
// }

export function newConfig(basePath: string) {
  const configPath = getConfigPath(basePath);

  return fse
    .pathExists(configPath)
    .then((exist: boolean) => {
      if (exist) {
        return showTextDocument(vscode.Uri.file(configPath));
      }

      return fse
        .outputJson(
          configPath,
          initialConfig(),
          { spaces: 4 }
        )
        .then(() => showTextDocument(vscode.Uri.file(configPath)));
    })
    .catch(reportError);
}
