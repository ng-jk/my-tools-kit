// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import * as path from 'path';
import { COMMAND_UPLOAD_FILE_CHANGED } from '../../../data/sftp/constants';
import { getAllFileService, getFileService } from '../modules/serviceManager/index';
import { uploadFile } from '../fileHandlers/index';
import {
  findGitRoot,
  listRecentCommits,
  getCommitChangedFiles,
  getUncommittedChangedFiles,
} from '../../../logic/sftp/git-changes';
import { checkCommand } from './abstract/createCommand';
import { showWarningMessage, showInformationMessage } from '../host';
import { simplifyPath } from '../helper/index';
import logger from '../logger';
import {handleCtxFromUri} from '../fileHandlers/createFileHandler';
import {confirmBatch} from './confirmBatch';
import * as output from '../ui/output';

const COMMIT_DEPTH = 30;
const UNCOMMITTED = '__uncommitted__';

export default checkCommand({
  id: COMMAND_UPLOAD_FILE_CHANGED,

  async handleCommand() {
    const dir = await pickRepository();
    if (!dir) {
      return;
    }

    const oid = await pickSource(dir);
    if (!oid) {
      return; // cancelled
    }

    let relPaths: string[];
    try {
      relPaths =
        oid === UNCOMMITTED
          ? await getUncommittedChangedFiles(dir)
          : await getCommitChangedFiles(dir, oid);
    } catch (error) {
      logger.error(error as Error, 'failed to read git changes');
      showWarningMessage('SFTP: could not read git changes — see the SFTP output channel.');
      return;
    }

    if (relPaths.length === 0) {
      showInformationMessage('SFTP: no created or modified files in that selection.');
      return;
    }

    if(oid!==UNCOMMITTED){logger.info('Selected commit '+oid+' determines filenames only. Uploading CURRENT LOCAL contents, not historical commit contents.');output.show(true);}
    const uploaded: string[] = [];
    const skipped: string[] = [];
    const selected=relPaths.map(rel=>{
      const fsPath=path.join(dir,rel),uri=vscode.Uri.file(fsPath);
      const ctx=getFileService(uri)?handleCtxFromUri(uri):undefined;
      return {rel,fsPath,ctx,check:ctx?.fileService.cancellationCheck()};
    });
    let pending=selected.filter(({rel,fsPath,ctx})=>{
      if (!ctx || ctx.config.ignore?.(fsPath,'local')) {skipped.push(rel);return false;}
      return true;
    });
    while(pending.length) {
      pending.forEach(item=>item.check!());
      if (!await confirmBatch(pending.map(item=>({ctx:item.ctx!,description:'upload current local content'})))) return;
      pending.forEach(item=>item.check!());
      const failed: typeof pending=[];
      for (const item of pending) {
        const {rel,ctx,check}=item;
        try {
          check!();
          await uploadFile(ctx!);
          uploaded.push(rel);
        } catch (error) {
          failed.push(item);
          logger.error(error as Error, `upload failed for ${rel}`);
        }
      }
      if (!failed.length) break;
      outputGroup('failed',failed.map(item=>item.rel));
      const action=await vscode.window.showErrorMessage(`SFTP: uploaded ${uploaded.length} file(s), skipped ${skipped.length}, failed ${failed.length}. Fix the connection or file error, then retry failed files.`, 'Show details', 'Retry failed', 'Close');
      if (action==='Show details') {output.show();return;}
      if (action!=='Retry failed') return;
      pending=failed;
    }

    logger.log('');
    logger.log('------ Upload File Changed Result ------');
    outputGroup('uploaded', uploaded);
    outputGroup('skipped (ignored / no SFTP config)', skipped);

    await showInformationMessage(
      `SFTP: uploaded ${uploaded.length} file(s)` +
        (skipped.length ? `, skipped ${skipped.length}.` : '.')
    );
  },
});

// Distinct git roots covering the configured SFTP workspaces.
async function collectGitRoots(): Promise<string[]> {
  const workspaces = Array.from(
    new Set(getAllFileService().map(service => service.workspace))
  );
  const roots = await Promise.all(workspaces.map(ws => findGitRoot(ws)));
  return Array.from(
    new Set(roots.filter((r): r is string => typeof r === 'string'))
  );
}

async function pickRepository(): Promise<string | undefined> {
  const roots = await collectGitRoots();
  if (roots.length === 0) {
    showWarningMessage('SFTP: no git repository found for the configured workspace(s).');
    return undefined;
  }
  if (roots.length === 1) {
    return roots[0];
  }

  const pick = await vscode.window.showQuickPick(
    roots.map(root => ({ label: path.basename(root), description: root, root })),
    { placeHolder: 'Choose a git repository' }
  );
  return pick && pick.root;
}

async function pickSource(dir: string): Promise<string | undefined> {
  const items: Array<vscode.QuickPickItem & { oid: string }> = [
    {
      label: '$(git-commit) Uncommitted changes',
      description: 'created + modified files in the working tree',
      oid: UNCOMMITTED,
    },
  ];

  try {
    const commits = await listRecentCommits(dir, COMMIT_DEPTH);
    commits.forEach(commit => {
      items.push({
        label: `${commit.oid.slice(0, 7)}  ${commit.summary}`,
        description: new Date(commit.timestamp * 1000).toLocaleString()+' - filenames only',
        detail: 'Uploads current local contents, not historical commit contents.',
        oid: commit.oid,
      });
    });
  } catch (error) {
    logger.error(error as Error, 'failed to list commits');
    // Still allow uploading uncommitted changes even if log fails.
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select filenames by commit or working changes; uploads CURRENT LOCAL contents, not historical commit contents',
    matchOnDescription: true,
  });
  return pick && pick.oid;
}

function outputGroup(label: string, items: string[]) {
  if (items.length <= 0) {
    return;
  }
  logger.log(`${label.toUpperCase()}:`);
  logger.log(items.map(rel => simplifyPath(rel)).join('\n'));
  logger.log('');
}
