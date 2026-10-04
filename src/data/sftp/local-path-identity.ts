import * as fs from 'fs';
import * as path from 'path';
import {randomUUID} from 'crypto';

// Case behavior belongs to a directory/volume, not to an operating system.
// Prefer a read-only lookup; an empty/numeric-only directory needs a temporary
// exclusive probe. If it cannot be inspected, fail rather than guess and overwrite.
export function directoryIgnoresCase(directory: string, io: any = fs): boolean {
  const names: string[] = io.readdirSync(directory);
  for (const name of names) {
    if (!/[a-zA-Z]/.test(name)) continue;
    const alternate = name.replace(/[a-zA-Z]/, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
    if (names.includes(alternate)) return false;
    try { io.lstatSync(path.join(directory, alternate)); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  const probe = path.join(directory, '.devkit-' + randomUUID());
  const alternate = path.join(directory, path.basename(probe).replace('devkit', 'DEVKIT'));
  const fd = io.openSync(probe, 'wx', 0o600);
  try {
    try { io.lstatSync(alternate); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  } finally { io.closeSync(fd); io.unlinkSync(probe); }
}

export function localPathIdentity(value: string): string {
  const absolute = path.resolve(value), parent = path.dirname(absolute);
  if (parent === absolute) return fs.realpathSync.native(absolute);
  try {
    const canonicalParent = fs.realpathSync.native(parent);
    const name = path.basename(absolute);
    return path.join(canonicalParent, directoryIgnoresCase(parent) ? name.toLowerCase() : name);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Missing directories inherit their nearest existing parent's behavior.
    let existing = parent;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const relative = path.relative(existing, absolute);
    return path.join(fs.realpathSync.native(existing), directoryIgnoresCase(existing) ? relative.toLowerCase() : relative);
  }
}
