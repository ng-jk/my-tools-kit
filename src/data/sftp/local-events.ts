import * as fs from 'fs';
import * as path from 'path';
const active = new Map<string, number>();
const completed = new Map<string, string>();
function fingerprint(value: string) {
  try { const s = fs.lstatSync(value); return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.mode].join(':'); }
  catch (error) { return error.code === 'ENOENT' ? 'missing' : 'unreadable'; }
}
export function beginLocalChange(value: string) {
  const key = path.resolve(value);
  active.set(key, (active.get(key) || 0) + 1);
  return () => {
    const count = active.get(key) || 1;
    if (count > 1) active.set(key,count-1); else active.delete(key);
    completed.delete(key); completed.set(key, fingerprint(key));
    if (completed.size > 10000) completed.delete(completed.keys().next().value);
  };
}
export function rememberLocalState(value: string) { beginLocalChange(value)(); }
export function localEntryExists(value: string) { return fingerprint(value) !== 'missing'; }
export async function trackLocalChanges<T>(values: string[], operation: () => Promise<T>): Promise<T> {
  const finish = Array.from(new Set(values)).map(beginLocalChange);
  try { return await operation(); } finally { finish.forEach(done => done()); }
}
export function isOwnLocalChange(value: string) {
  const key = path.resolve(value);
  for (const pending of active.keys()) {
    if (key === pending || key.startsWith(pending + path.sep) || pending.startsWith(key + path.sep)) return true;
  }
  if (!completed.has(key)) return false;
  if (completed.get(key) === fingerprint(key)) return true;
  completed.delete(key); return false;
}
