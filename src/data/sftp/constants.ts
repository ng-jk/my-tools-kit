// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as path from 'path';

const VENDOR_FOLDER = '.vscode';

export const EXTENSION_NAME = 'devkit.sftp';
export const SETTING_KEY_REMOTE = 'remotefs.remote';

export const REMOTE_SCHEME = 'devkit-sftp';

export const CONGIF_FILENAME = 'sftp.json';
export const CONFIG_PATH = path.join(VENDOR_FOLDER, CONGIF_FILENAME);

// command not in package.json
export const COMMAND_TOGGLE_OUTPUT = 'devkit.sftp.toggleOutput';

// commands in package.json
export const COMMAND_CONFIG = 'devkit.sftp.config';
export const COMMAND_SET_PROFILE = 'devkit.sftp.setProfile';
export const COMMAND_CANCEL_ALL_TRANSFER = 'devkit.sftp.cancelAllTransfer';
export const COMMAND_OPEN_CONNECTION_IN_TERMINAL = 'devkit.sftp.openConnectInTerminal';

export const COMMAND_FORCE_UPLOAD = 'devkit.sftp.forceUpload';
export const COMMAND_UPLOAD = 'devkit.sftp.upload';
export const COMMAND_UPLOAD_FILE = 'devkit.sftp.upload.file';
export const COMMAND_UPLOAD_CHANGEDFILES = 'devkit.sftp.upload.changedFiles';
export const COMMAND_UPLOAD_FILE_CHANGED = 'devkit.sftp.upload.fileChanged';
export const COMMAND_UPLOAD_ACTIVEFILE = 'devkit.sftp.upload.activeFile';
export const COMMAND_UPLOAD_FOLDER = 'devkit.sftp.upload.folder';
export const COMMAND_UPLOAD_ACTIVEFOLDER = 'devkit.sftp.upload.activeFolder';
export const COMMAND_UPLOAD_PROJECT = 'devkit.sftp.upload.project';

export const COMMAND_FORCE_UPLOAD_TO_ALL_PROFILES = 'devkit.sftp.forceUpload.to.allProfiles';
export const COMMAND_UPLOAD_TO_ALL_PROFILES = 'devkit.sftp.upload.to.allProfiles';
export const COMMAND_UPLOAD_FILE_TO_ALL_PROFILES = 'devkit.sftp.upload.file.to.allProfiles';
export const COMMAND_UPLOAD_ACTIVEFILE_TO_ALL_PROFILES = 'devkit.sftp.upload.activeFile.to.allProfiles';
export const COMMAND_UPLOAD_FOLDER_TO_ALL_PROFILES = 'devkit.sftp.upload.folder.to.allProfiles';
export const COMMAND_UPLOAD_ACTIVEFOLDER_TO_ALL_PROFILES = 'devkit.sftp.upload.activeFolder.to.allProfiles';
export const COMMAND_UPLOAD_PROJECT_TO_ALL_PROFILES = 'devkit.sftp.upload.project.to.allProfiles';

export const COMMAND_FORCE_DOWNLOAD = 'devkit.sftp.forceDownload';
export const COMMAND_DOWNLOAD = 'devkit.sftp.download';
export const COMMAND_DOWNLOAD_FILE = 'devkit.sftp.download.file';
export const COMMAND_DOWNLOAD_ACTIVEFILE = 'devkit.sftp.download.activeFile';
export const COMMAND_DOWNLOAD_FOLDER = 'devkit.sftp.download.folder';
export const COMMAND_DOWNLOAD_ACTIVEFOLDER = 'devkit.sftp.download.activeFolder';
export const COMMAND_DOWNLOAD_PROJECT = 'devkit.sftp.download.project';

export const COMMAND_SYNC_LOCAL_TO_REMOTE = 'devkit.sftp.sync.localToRemote';
export const COMMAND_SYNC_REMOTE_TO_LOCAL = 'devkit.sftp.sync.remoteToLocal';
export const COMMAND_SYNC_BOTH_DIRECTIONS = 'devkit.sftp.sync.bothDirections';

export const COMMAND_DIFF = 'devkit.sftp.diff';
export const COMMAND_DIFF_ACTIVEFILE = 'devkit.sftp.diff.activeFile';
export const COMMAND_LIST = 'devkit.sftp.list';
export const COMMAND_LIST_ACTIVEFOLDER = 'devkit.sftp.listActiveFolder';
export const COMMAND_LIST_ALL = 'devkit.sftp.listAll';
export const COMMAND_DELETE_REMOTE = 'devkit.sftp.delete.remote';
export const COMMAND_REVEAL_IN_EXPLORER = 'devkit.sftp.revealInExplorer';
export const COMMAND_REVEAL_IN_REMOTE_EXPLORER = 'devkit.sftp.revealInRemoteExplorer';

export const COMMAND_REMOTEEXPLORER_REFRESH = 'devkit.sftp.remoteExplorer.refresh';
export const COMMAND_REMOTEEXPLORER_REFRESH_ACTIVE_FILE = "devkit.sftp.remoteExplorer.refreshActiveFile"
export const COMMAND_REMOTEEXPLORER_EDITINLOCAL = 'devkit.sftp.remoteExplorer.editInLocal';
export const COMMAND_REMOTEEXPLORER_VIEW_CONTENT = 'devkit.sftp.viewContent';

export const COMMAND_CREATE_FOLDER = 'devkit.sftp.create.folder';
export const COMMAND_CREATE_FILE = 'devkit.sftp.create.file';
