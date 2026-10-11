// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
export interface FileHandleOption {
  expectedSourceType?: 'file' | 'directory';
  ignore?: ((filepath: string, side?: 'local' | 'remote') => boolean) | null;
}
