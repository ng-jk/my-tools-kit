export function assertEntryName(name: string) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\x00-\x1f\x7f:]/.test(name)
      || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('Unsafe remote directory entry name: ' + JSON.stringify(name));
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
