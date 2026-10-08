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

    const uploaded: string[] = [];
    const skipped: string[] = [];
    const selected=relPaths.map(rel=>{
      const fsPath=path.join(dir,rel),uri=vscode.Uri.file(fsPath);
      const ctx=getFileService(uri)?handleCtxFromUri(uri):undefined;
      return {rel,fsPath,ctx,check:ctx?.fileService.cancellationCheck()};
    });
    for (const {rel,fsPath,ctx,check} of selected) {
        // Only files that belong to an SFTP service can be uploaded.
        if (!ctx) {
          skipped.push(rel);
          continue;
        }
        try {
          check!();
          if (ctx.config.ignore?.(fsPath, 'local')) { skipped.push(rel); continue; }
          await uploadFile(ctx);
          uploaded.push(rel);
        } catch (error) {
          skipped.push(rel);
          logger.error(error as Error, `upload failed for ${rel}`);
        }
    }

    logger.log('');
    logger.log('------ Upload File Changed Result ------');
    outputGroup('uploaded', uploaded);
    outputGroup('skipped (ignored / no SFTP config / failed)', skipped);

    showInformationMessage(
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
        description: new Date(commit.timestamp * 1000).toLocaleString(),
        oid: commit.oid,
      });
    });
  } catch (error) {
    logger.error(error as Error, 'failed to list commits');
    // Still allow uploading uncommitted changes even if log fails.
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Upload created + modified files from…',
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
