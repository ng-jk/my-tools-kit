"""One-time adaptation following import-sftp.py; builds consume the resulting maintained sources."""
from pathlib import Path
import os
import re
root = Path(__file__).resolve().parent.parent
ports = root / 'src/data/sftp/ports'
files = root / 'src/data/sftp/config-files'
def rel(file, target):
    value = os.path.relpath(target, file.parent).replace('\\','/')
    return value if value.startswith('.') else './'+value
for layer in ('data','logic'):
    for file in (root / 'src' / layer / 'sftp').rglob('*.ts'):
        text = file.read_text(encoding='utf-8')
        text = re.sub(r"import app from '[^']*interface/sftp/app';", f"import app from '{rel(file,ports)}';", text)
        text = re.sub(r"import logger from '[^']*interface/sftp/logger';", f"import {{ logger }} from '{rel(file,ports)}';", text)
        text = re.sub(r"from '[^']*interface/sftp/host'", f"from '{rel(file,ports)}'", text)
        text = re.sub(r"from '[^']*interface/sftp/helper/index'", f"from '{rel(file,files)}'", text)
        if file.name == 'fileService.ts':
            text = text.replace("import * as fs from 'fs';", f"import * as fs from '{rel(file,files)}';")
            # Preserve errors through the scheduler instead of silently reporting success.
            text = text.replace('let runningPromise: Promise<void> | null = null;', 'let runningPromise: Promise<void> | null = null;\n    const failures: Error[] = [];\n    scheduler.onTaskDone((error) => { if (error) failures.push(error); });')
            text = text.replace('new Promise(resolve => {\n            scheduler.onIdle', 'new Promise((resolve, reject) => {\n            scheduler.onIdle')
            text = text.replace('              resolve();', "              if (failures.length) reject(failures[0]); else resolve();")
        if file.name == 'fileBaseOperations.ts':
            text = text.replace("import { window } from 'vscode';", '')
            a = text.index('  try {', text.index('export async function createFile'))
            b = text.index('  const targetFd',a)
            text = text[:a] + "  let exists = false;\n  try { await fs.lstat(path); exists = true; } catch (error) {\n    if (![2, 'ENOENT', 550].includes(error.code)) throw error;\n  }\n  if (exists) throw new Error('File already exists: ' + path);\n\n" + text[b:]
        if file.name == 'uResource.ts':
            text = text.replace("import { Uri } from 'vscode';", "import { URI as Uri } from 'vscode-uri';")
            text = text.replace('config instanceof Uri', "(config && typeof (config as any).scheme === 'string')")
        if file.name == 'transfer.ts':
            text = text.replace('fileMissed.forEach(file => removeFile(file, targetFs, FileType.File, transferOption));', 'await Promise.all(fileMissed.map(file => removeFile(file, targetFs, FileType.File, transferOption)));')
            text = text.replace('dirMissed.forEach(file => removeFile(file, targetFs, FileType.Directory, transferOption));', 'await Promise.all(dirMissed.map(file => removeFile(file, targetFs, FileType.Directory, transferOption)));')
            # Only a missing directory can be interpreted as empty; permission/transport failures abort sync.
            text = text.replace('.catch(err => [])', ".catch(err => { if (err.code === 'ENOENT' || err.code === 2) return []; throw err; })")
        file.write_text(text,encoding='utf-8')

# Share profile/cache/status with the engine without importing UI from core.
file = root / 'src/interface/sftp/app.ts'
text = file.read_text(encoding='utf-8')
text = text.replace('const app: App = Object.create(null);', "import shared from '../../data/sftp/ports';\nconst app: App = shared;")
file.write_text(text,encoding='utf-8')
file = root / 'src/interface/sftp/modules/appState.ts'
text = file.read_text(encoding='utf-8').replace('this._observer(this.getStateSnapshot());','if (this._observer) this._observer(this.getStateSnapshot());')
file.write_text(text,encoding='utf-8')
# Wire host callbacks before loading/activating the fork.
file = root / 'src/interface/sftp/extension.ts'
text = file.read_text(encoding='utf-8')
text = "import { configurePorts } from '../../data/sftp/ports';\nimport logger from './logger';\n"+text
text = text.replace('  try {\n    initCommands(context);', "  if (!vscode.workspace.isTrusted) return;\n  configurePorts({ settings: (section: string) => vscode.workspace.getConfiguration(section), password: (prompt: string) => vscode.window.showInputBox({prompt, password:true, ignoreFocusOut:true}), documents: () => vscode.workspace.textDocuments, log: (level: string, ...args: any[]) => logger[level](...args) });\n  try {\n    initCommands(context);")
file.write_text(text,encoding='utf-8')
