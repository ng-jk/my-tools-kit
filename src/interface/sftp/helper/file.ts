// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as path from 'path';
import * as tmp from 'tmp';
import * as vscode from 'vscode';
import { CONGIF_FILENAME } from '../../../data/sftp/constants';
import { upath } from '../../../logic/sftp/core/index';

export function isValidFile(uri: vscode.Uri) {
  return uri.scheme === 'file';
}

export function isConfigFile(uri: vscode.Uri) {
  const filename = path.basename(uri.fsPath);
  return filename === CONGIF_FILENAME;
}

export function fileDepth(file: string) {
  return upath.normalize(file).split('/').length;
}

export function makeTmpFile(option: any): Promise<string> {
  return new Promise((resolve, reject) => {
    tmp.file({ ...option, discardDescriptor: true }, (err: any, tmpPath: string) => {
      if (err) reject(err);

      resolve(tmpPath);
    });
  });
}
