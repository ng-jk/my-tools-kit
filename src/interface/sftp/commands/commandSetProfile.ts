// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as vscode from 'vscode';
import { COMMAND_SET_PROFILE } from '../../../data/sftp/constants';
import { showInformationMessage } from '../host';
import app from '../app';
import logger from '../logger';
import { getAllFileService, reloadWorkspaceServices } from '../modules/serviceManager/index';
import { checkCommand } from './abstract/createCommand';

// A profile changes watcher policy as well as context and connection settings.
// Recreate every affected service even when its local context is unchanged.
async function reloadOnProfileChange(
  prevProfile: string | null,
  nextProfile: string | null
) {

  const workspaces = new Set<string>();
  getAllFileService().forEach(service => {
    workspaces.add(service.workspace);
  });

  for (const workspace of workspaces) {
    await reloadWorkspaceServices(workspace, { preserveProfile: true });
  }
}

export default checkCommand({
  id: COMMAND_SET_PROFILE,

  async handleCommand(definedProfile) {
    const profiles = getAllFileService().reduce<
      Array<vscode.QuickPickItem & { value: string | null }>
    >(
      (acc, service) => {
        if (service.getAvailableProfiles().length <= 0) {
          return acc;
        }

        service.getAvailableProfiles().forEach(profile => {
          acc.push({
            value: profile,
            label: service.profile === profile ? `${profile} (active)` : profile,
          });
        });
        return acc;
      },
      [
        {
          value: null,
          label: 'UNSET',
        },
      ]
    );

    if (profiles.length <= 1) {
      showInformationMessage('No Available Profile.');
      return;
    }

    const prevProfile = app.state.profile;
    let nextProfile: string | null;

    if (definedProfile !== undefined) {
      const index = profiles.findIndex(a => a.value === definedProfile);
      if (index !== -1) {
        nextProfile = definedProfile;
      } else {
        nextProfile = null;
        logger.warn(`try to set a unknown profile "${definedProfile}"`);
      }
    } else {
      const item = await vscode.window.showQuickPick(profiles, { placeHolder: 'select a profile' });
      if (item === undefined) return; // user cancelled — leave profile unchanged
      nextProfile = item.value;
    }

    app.state.profile = nextProfile;
    // Reload services and watcher policies for the new profile. Runs for
    // BOTH the programmatic and the quick-pick paths.
    await reloadOnProfileChange(prevProfile, nextProfile);
  },
});
