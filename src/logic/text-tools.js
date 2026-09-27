'use strict';
const MAX_TEXT = 20 * 1024 * 1024;

function checkSize(text) {
  if (typeof text !== 'string') throw new Error('Expected text');
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT) throw new Error('Text exceeds the 20 MiB limit. Open larger files directly in VS Code.');
}
function jsonTokens(input) {
  checkSize(input);
  const text = input.replace(/^\uFEFF/, '');
  // Validate syntax, but never stringify the parsed value: that would round large integers.
  try { JSON.parse(text); }
  catch (e) {
    const position = /position (\d+)/.exec(e.message)?.[1];
    if (position !== undefined && !e.message.includes('line ')) {
      const preceding = text.slice(0, Number(position));
      const line = preceding.split('\n').length, column = Number(position) - preceding.lastIndexOf('\n');
      throw new Error(`Invalid JSON at line ${line}, column ${column}: ${e.message}`);
    }
    throw new Error('Invalid JSON: ' + e.message);
  }
  const token = /\s+|"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/gy;
  const tokens = []; let match;
  while ((match = token.exec(text))) if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
  return tokens;
}
function formatJson(text, options = {}) {
  const tokens = jsonTokens(text);
  if (options.minify) return tokens.join('');
  const indent = options.indent === 'tab' ? '\t' : ' '.repeat(options.indent === 4 ? 4 : 2);
  let depth = 0, size = 0; const output = [];
  const append = value => { size += value.length; if (size > MAX_TEXT * 2) throw new Error('Formatted JSON exceeds the 40 MiB character limit'); output.push(value); };
  const line = () => append('\n' + indent.repeat(depth));
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '{' || t === '[') {
      append(t); depth++;
      if (depth > 256) throw new Error('JSON nesting exceeds the formatter limit of 256 levels');
      if (tokens[i + 1] !== '}' && tokens[i + 1] !== ']') line();
    } else if (t === '}' || t === ']') {
      depth--; if (tokens[i - 1] !== '{' && tokens[i - 1] !== '[') line(); append(t);
    } else if (t === ',') { append(t); line(); }
    else if (t === ':') append(': ');
    else append(t);
  }
  return output.join('');
}
function normalizeText(text, options = {}) {
  checkSize(text);
  let value = options.json ? formatJson(text) : text;
  if (options.lineEndings) value = value.replace(/\r\n?/g, '\n');
  if (options.trimWhitespace) value = value.split(/\r\n|\n|\r/).map(line => line.trim()).join('\n');
  if (options.ignoreCase) value = value.toLowerCase();
  return value;
}
function decodeText(buffer) {
  if (buffer.length > MAX_TEXT) throw new Error('File exceeds the 20 MiB limit. Open it directly in VS Code.');
  let bytes = buffer, encoding = 'utf-8';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) { encoding = 'utf-16le'; bytes = buffer.subarray(2); }
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) { encoding = 'utf-16be'; bytes = buffer.subarray(2); }
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (text.includes('\0')) return null;
    return text;
  } catch { return null; }
}
module.exports = { MAX_TEXT, checkSize, formatJson, normalizeText, decodeText };
