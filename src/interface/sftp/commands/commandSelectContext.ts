import * as vscode from 'vscode';
import * as path from 'path';
import {contextNames, selectContext} from '../../../logic/sftp/config';
import {checkCommand} from './abstract/createCommand';
export default checkCommand({
  id:'devkit.sftp.selectContext',
  async handleCommand() {
    const folders = vscode.workspace.workspaceFolders || [];
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(folders.map(f => ({label:f.name, folder:f}))).then(x => x?.folder);
    if (!folder) return;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(folder.uri.fsPath,'.vscode','sftp.json')));
    if (document.isDirty) throw new Error('Save your SFTP configuration before selecting a context');
    const original = document.getText();
    const raw = JSON.parse(original);
    const names = contextNames(raw);
    if (!names.length) throw new Error('Use the named contexts format in sftp.json; see README: Separate FTP/SFTP contexts');
    const selected = await vscode.window.showQuickPick(names.map(name => ({label:name,description:name===raw.activeContext?'Active context':'',name})),{placeHolder:'Select FTP/SFTP context — connection settings and credentials are isolated'});
    if (!selected) return;
    if (document.getText() !== original || document.isDirty) throw new Error('Configuration changed; select the context again');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(original.length)),JSON.stringify(selectContext(raw,selected.name),null,2)+'\n');
    if (!await vscode.workspace.applyEdit(edit) || !await document.save()) throw new Error('Could not save the selected context');
    // The existing config-save handler disposes old connections/watchers and reloads.
  }
});
