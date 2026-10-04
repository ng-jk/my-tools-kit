"""One-time source import; do not run during builds (the imported fork is maintained here)."""
import json
import os
from pathlib import Path
import re
import shutil

root = Path(__file__).resolve().parent.parent
upstream = root / 'repositories/vscode-sftp'
origin = upstream / 'src'
mapping = {}
data_core = {'upath', 'customError', 'localFs', 'remoteFs', 'mirror', 'fileBaseOperations'}
for file in origin.rglob('*.ts'):
    name = file.relative_to(origin).as_posix()
    if '__tests__' in name or name.startswith('types/'):
        continue
    layer = 'interface'
    if name.startswith(('core/fs/', 'core/remote-client/')) or name in {f'core/{n}.ts' for n in data_core}:
        layer = 'data'
    elif name.startswith('core/') or name in ('utils.ts', 'fileHandlers/option.ts', 'fileHandlers/transfer/transfer.ts'):
        layer = 'logic'
    elif name == 'constants.ts':
        layer = 'data'
    mapping[file.resolve()] = root / 'src' / layer / 'sftp' / name

def relative(source, target):
    value = os.path.relpath(target, source.parent).replace('\\', '/')
    return (value if value.startswith('.') else './' + value).removesuffix('.ts')

for old, new in mapping.items():
    text = old.read_text(encoding='utf-8')
    def replace(match):
        dep = match[2]
        if not dep.startswith('.'):
            return match[0]
        candidate = old.parent / dep
        choices = [Path(str(candidate) + '.ts'), Path(str(candidate) + '.d.ts'), candidate / 'index.ts']
        resolved = next((p.resolve() for p in choices if p.exists()), None)
        if resolved not in mapping:
            raise ValueError(f'Unmapped import {old}: {dep}')
        return match[1] + relative(new, mapping[resolved]) + match[3]
    text = re.sub(r"((?:from\s+|require\()['\"])([^'\"]+)(['\"])", replace, text)
    # Separate IDs so the original SFTP extension can remain installed.
    text = text.replace("'sftp.", "'devkit.sftp.").replace('"sftp.', '"devkit.sftp.')
    text = text.replace('command:sftp.', 'command:devkit.sftp.')
    text = text.replace("'remoteExplorer'", "'devkit.remoteExplorer'")
    if old.name == 'constants.ts':
        text = text.replace("EXTENSION_NAME = 'sftp'", "EXTENSION_NAME = 'devkit.sftp'").replace("REMOTE_SCHEME = 'remote'", "REMOTE_SCHEME = 'devkit-sftp'")
    new.parent.mkdir(parents=True, exist_ok=True)
    new.write_text('// Adapted from ng-jk/vscode-sftp (MIT); see THIRD-PARTY-NOTICES.md.\n' + text, encoding='utf-8')

target = root / 'vendor/sftp'
target.mkdir(parents=True, exist_ok=True)
for name in ('LICENSE', 'README.md', 'package.json'):
    shutil.copy2(upstream / name, target / name)
shutil.copytree(upstream / 'schema', target / 'schema', dirs_exist_ok=True)
shutil.copytree(upstream / 'resources', target / 'resources', dirs_exist_ok=True)
(target / 'provenance.json').write_text(json.dumps({'repository': 'https://github.com/ng-jk/vscode-sftp', 'commit': 'ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8', 'version': '1.16.3', 'sourceMapping': {str(k.relative_to(origin)).replace('\\','/'): str(v.relative_to(root)).replace('\\','/') for k,v in mapping.items()}}, indent=2), encoding='utf-8')
print(f'Imported {len(mapping)} source files; maintain the fork in src/*/sftp.')
