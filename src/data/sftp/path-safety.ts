import * as path from 'path';

export function assertEntryName(name: string) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\x00-\x1f\x7f:]/.test(name)
      || /[. ]$/.test(name)) {
    throw new Error('Unsafe remote directory entry name: ' + JSON.stringify(name));
  }
}

// Device names are a Windows local-filesystem constraint, not a remote
// directory-listing constraint. An unrelated remote sibling must not block uploads.
export function assertLocalPath(value: string) {
  if (process.platform !== 'win32') return;
  const absolute=path.resolve(value),root=path.parse(absolute).root;
  for(const name of absolute.slice(root.length).split(/[\\/]/)) {
    if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/i.test(name))
      throw new Error('Cannot use Windows reserved device name in a local path: '+JSON.stringify(name)+'. Rename the remote entry before downloading it to Windows.');
  }
}
export function checkedEntries(fs: any, directory: string, entries: any[]) {
  for (const entry of entries) {
    assertEntryName(entry.name);
    const expected = fs.pathResolver.normalize(fs.pathResolver.join(directory, entry.name));
    if (fs.pathResolver.normalize(entry.fspath) !== expected) throw new Error('Directory entry escapes its parent: ' + entry.name);
  }
  return entries;
}
