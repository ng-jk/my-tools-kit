// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import * as path from 'path';
import { COMMAND_UPLOAD_CHANGEDFILES } from '../../../data/sftp/constants';
import { getFileService } from '../modules/serviceManager/index';
import { uploadFile, renameRemote, removeRemote } from '../fileHandlers/index';
import { getGitService, GitAPI, Repository, Status, Change } from '../modules/git/index';
import { checkCommand } from './abstract/createCommand';
import logger from '../logger';
import {localEntryExists} from '../../../data/sftp/local-events';
import {reconcileGitChanges, planGitTransfers, executeGitTransfers, GitChange} from '../../../logic/sftp/git-transfer';

export default checkCommand({
  id: COMMAND_UPLOAD_CHANGEDFILES,

  async handleCommand(hint: any) {
    return handleCommand(hint);


  },
});

function isRepository(object: any): object is Repository {
  return 'rootUri' in object;
}

function isSourceControlResourceGroup(object: any): object is vscode.SourceControlResourceGroup {
  return 'id' in object && 'resourceStates' in object;
}

async function handleCommand(hint: any) {
  let repository: Repository | undefined;
  let filterGroupId;
  const git = getGitService();

  if (!hint) {
    repository = await getRepository(git);
  } else if (isSourceControlResourceGroup(hint)) {
    repository = git.repositories.find(repo => repo.ui.selected);
    filterGroupId = hint.id;
  } else if (isRepository(hint)) {
    repository = git.repositories.find(repo => repo.ui.selected);
  }

  if (!repository) {
    return;
  }

  let changes: Change[];
  if (filterGroupId === 'index') {
    changes = repository.state.indexChanges;
  } else if (filterGroupId === 'workingTree') {
    changes = repository.state.workingTreeChanges;
  } else {
    changes = repository.state.indexChanges.concat(repository.state.workingTreeChanges);
  }

  const normalized: GitChange[] = changes.flatMap(change => {
    const destination = (change.renameUri || change.uri).fsPath;
    if (change.status === Status.INDEX_RENAMED) return [{kind:'rename' as const,path:destination,oldPath:change.originalUri.fsPath}];
    if ([Status.INDEX_DELETED,Status.DELETED].includes(change.status)) return [{kind:'delete' as const,path:destination}];
    if ([Status.INDEX_MODIFIED,Status.MODIFIED,Status.INDEX_ADDED,Status.UNTRACKED].includes(change.status)) return [{kind:'upload' as const,path:destination}];
    return [];
  });
  const plan = planGitTransfers(reconcileGitChanges(normalized, localEntryExists), file => {
    const service = getFileService(vscode.Uri.file(file));
    return service && !service.getConfig().ignore?.(file) ? service.baseDir : undefined;
  });
  await executeGitTransfers(plan, {
    upload: file => uploadFile(vscode.Uri.file(file)),
    rename: (from,to) => renameRemote(vscode.Uri.file(to),{originPath:from}),
    delete: file => removeRemote(vscode.Uri.file(file)),
  });
  logger.log('------ Upload Changed Files Result ------');
  plan.forEach(operation => logger.log(`${operation.kind}: ${operation.path}`));
}

async function getRepository(git: GitAPI): Promise<Repository | undefined> {
  if (git.repositories.length === 1) {
    return git.repositories[0];
  }

  if (git.repositories.length === 0) {
    throw new Error('There are no available repositories');
  }

  const picks = git.repositories.map(repo => {
    const label = path.basename(repo.rootUri.fsPath);
    const description = repo.state.HEAD ? repo.state.HEAD.name : '';

    return {
      label,
      description,
      repository: repo,
    };
  });

  const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Choose a repository' });

  return pick && pick.repository;
}
