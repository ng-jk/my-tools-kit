'use strict';
// Resolve SCM groups from Git's state, not directory nesting: a parent repository
// can track files underneath another open repository's root.
function repositoryForGroup(repositories, group) {
  const field = {index:'indexChanges',workingTree:'workingTreeChanges'}[group.id];
  if (!field) throw new Error('Unsupported Git change group. Choose Changes or Staged Changes.');
  const paths = group.resourceStates.map(resource => resource.resourceUri?.fsPath);
  if (!paths.length) return undefined;
  if (paths.some(file => !file)) throw new Error('Cannot identify the repository for this Git resource');
  const candidates = repositories.filter(repository => {
    const files = new Set((repository.state[field] || []).flatMap(change =>
      [change.uri?.fsPath,change.originalUri?.fsPath,change.renameUri?.fsPath].filter(Boolean)));
    return paths.every(file => files.has(file));
  });
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new Error('The selected Git changes are stale or belong to different repositories. Refresh Source Control and select one repository’s change group.');
  throw new Error('The selected Git changes match multiple repositories. Run Upload Changed Files from the toolkit and choose the repository.');
}
module.exports = {repositoryForGroup};
