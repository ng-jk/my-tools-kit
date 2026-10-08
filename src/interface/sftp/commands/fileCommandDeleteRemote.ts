// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import {COMMAND_DELETE_REMOTE} from '../../../data/sftp/constants';
import {assertRemoteChild} from '../../../logic/sftp/remote-operations';
import {removeRemote} from '../fileHandlers';
import {handleCtxFromUri} from '../fileHandlers/createFileHandler';
import {showConfirmMessage} from '../host';
import {checkCommand} from './abstract/createCommand';
import {selectRemoteTarget} from './shared';
export default checkCommand({
  id:COMMAND_DELETE_REMOTE,
  async handleCommand(item,items) {
    const selected=await selectRemoteTarget(item,items);
    if (!selected) return;
    const targets=(Array.isArray(selected)?selected:[selected]).map(uri=>{
      const ctx=handleCtxFromUri(uri);
      assertRemoteChild(ctx.target.remoteFsPath,ctx.config.remotePath);
      return {ctx,check:ctx.fileService.cancellationCheck()};
    });
    const detail=targets.map(({ctx})=>`${ctx.fileService.name} / ${ctx.fileService.profile || 'base'} (${ctx.config.host}:${ctx.config.port}) ${ctx.target.remoteFsPath}`).join('\n');
    if (!await showConfirmMessage(`Permanently delete these remote targets? Folders include their non-ignored descendants. This cannot be undone.\n${detail}`,'Delete permanently','Cancel')) return;
    for (const {ctx,check} of targets) {check();await removeRemote(ctx);}
  }
});
