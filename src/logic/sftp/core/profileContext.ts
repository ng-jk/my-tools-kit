// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
/**
 * Resolve the effective (raw, unresolved) `context` for a config under a given
 * profile. A profile may override the base `context`; when it does, the service's
 * local root changes with the active profile. Pure + dependency-free so it can be
 * used by both `FileService` (core) and the serviceManager (modules) and unit
 * tested without vscode.
 */
export function resolveProfileContext(
  config: { context?: string; profiles?: { [name: string]: { context?: string } } },
  profile: string | null | undefined
): string | undefined {
  if (
    config.profiles &&
    profile &&
    config.profiles[profile] &&
    config.profiles[profile].context != null
  ) {
    return config.profiles[profile].context;
  }
  return config.context;
}
