// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import * as path from 'path';
import { COMMAND_UPLOAD_CHANGEDFILES } from '../../../data/sftp/constants';
import { getFileService } from '../modules/serviceManager/index';
import { uploadFile, renameRemote, removeRemote } from '../fileHandlers/index';
import { getGitService, GitAPI, Repository, Status, Change } from '../modules/git/index';
import { checkCommand } from './abstract/createCommand';
import logger from '../logger';
import {showConfirmMessage} from '../host';
import {handleCtxFromUri} from '../fileHandlers/createFileHandler';
import {localEntryExists} from '../../../data/sftp/local-events';
import {reconcileGitChanges, planGitTransfers, executeGitTransfers, GitChange} from '../../../logic/sftp/git-transfer';

export default checkCommand({
  id: COMMAND_UPLOAD_CHANGEDFILES,

  async handleCommand(hint: any) {
    return handleCommand(hint);


  },
});

function isRepository(object: any): object is Repository {
  return object && typeof object === 'object' && 'rootUri' in object;
}

function isSourceControlResourceGroup(object: any): object is vscode.SourceControlResourceGroup {
  return object && typeof object === 'object' && 'id' in object && 'resourceStates' in object;
}

async function handleCommand(hint: any) {
  let repository: Repository | undefined;
  let filterGroupId;
  const git = getGitService();

  if (!hint) {
    repository = await getRepository(git);
  } else if (isSourceControlResourceGroup(hint)) {
    const owners = new Set<Repository>();
    for (const resource of hint.resourceStates) {
      const file = resource.resourceUri?.fsPath;
      if (!file) throw new Error('Cannot identify the repository for this Git resource');
      const owner = git.repositories.filter(repo => {
        const relative = path.relative(repo.rootUri.fsPath, file);
        return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      }).sort((a,b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
      if (!owner) throw new Error('No repository owns the selected Git resource');
      owners.add(owner);
    }
    if (!owners.size) return;
    if (owners.size !== 1) throw new Error('Select changes from one repository at a time');
    repository = [...owners][0];
    filterGroupId = hint.id;
  } else if (isRepository(hint)) {
    repository = git.repositories.find(repo => path.relative(repo.rootUri.fsPath, hint.rootUri.fsPath) === '');
    if (!repository) throw new Error('The selected repository is no longer available');
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
  const contexts = new Map(plan.map(operation => {
    const ctx = handleCtxFromUri(vscode.Uri.file(operation.path));
    return [operation.path, {ctx, check:ctx.fileService.cancellationCheck()}] as const;
  }));
  const destructive = plan.filter(operation => operation.kind !== 'upload');
  if (destructive.length) {
    const details = destructive.map(operation => {
      const {ctx} = contexts.get(operation.path)!;
      return `${operation.kind}: ${ctx.fileService.name} (${ctx.config.host}:${ctx.config.port}) ${ctx.target.remoteFsPath}`;
    }).join('\n');
    if (!await showConfirmMessage(`Apply Git changes including remote deletions or renames?\n${details}`, 'Apply changes', 'Cancel')) return;
  }
  const selected = (file: string) => { const {ctx,check}=contexts.get(file)!;check();return ctx; };
  await executeGitTransfers(plan, {
    upload: file => uploadFile(selected(file)),
    rename: (from,to) => renameRemote(selected(to),{originPath:from}),
    delete: file => removeRemote(selected(file)),
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
