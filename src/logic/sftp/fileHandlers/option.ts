// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
export interface FileHandleOption {
  explicitUpload?: boolean;
  expectedSourceType?: 'file' | 'directory';
  ignore?: ((filepath: string, side?: 'local' | 'remote') => boolean) | null;
}
