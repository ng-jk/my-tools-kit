// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.
import * as path from 'path';
import { LocalFileSystem } from './fs/index';

const fs = new LocalFileSystem(path);

export default fs;
