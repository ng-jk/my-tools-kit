// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
export interface FileHandleOption {
  ignore?: ((filepath: string) => boolean) | null;
}
