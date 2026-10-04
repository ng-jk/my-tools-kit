import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, createHmac } from 'crypto';
import { logger } from './ports';
export function fingerprint(key: Buffer) { return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, ''); }
function matches(pattern: string, host: string) {
  if (pattern.startsWith('|1|')) {
    const parts = pattern.split('|');
    return parts.length === 4 && createHmac('sha1', Buffer.from(parts[2], 'base64')).update(host).digest('base64') === parts[3];
  }
  return new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i').test(host);
}
export function verifyHostKey(config: any, key: Buffer) {
  const actual = fingerprint(key);
  if (config.hostFingerprint) {
    const pins = Array.isArray(config.hostFingerprint) ? config.hostFingerprint : [config.hostFingerprint];
    return pins.includes(actual);
  }
  const host = Number(config.port || 22) === 22 ? config.host : `[${config.host}]:${config.port}`;
  const filename = config.knownHostsPath || path.join(os.homedir(), '.ssh', 'known_hosts');
  let content: string;
  try { content = fs.readFileSync(filename, 'utf8'); }
  catch (error) { logger.warn(`SSH host key is not trusted for ${host}. Verify ${actual} with the server administrator, then set hostFingerprint or knownHostsPath.`); return false; }
  let trusted = false;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const fields = line.trim().split(/\s+/);
    const marker = fields[0].startsWith('@') ? fields.shift() : '';
    if (fields.length < 3) continue;
    const patterns = fields[0].split(',');
    if (patterns.some(p => p.startsWith('!') && matches(p.slice(1), host)) || !patterns.some(p => !p.startsWith('!') && matches(p, host))) continue;
    if (fields[2] === key.toString('base64')) {
      if (marker === '@revoked') return false;
      if (!marker) trusted = true;
    }
  }
  if (!trusted) logger.warn(`Unknown or changed SSH key for ${host}: ${actual}. Verify it independently before updating known_hosts or hostFingerprint.`);
  return trusted;
}
