// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import { GitExtension, API, Status, Change, Repository } from './git.d';

let git: API;

export { API as GitAPI, Repository, Status, Change };

export function getGitService(): API {
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports;

  git = gitExtension.getAPI(1);
  return git;
}
