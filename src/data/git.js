'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const MAX_TEXT = 20 * 1024 * 1024;
async function git(root, args) {
  try {
    const { stdout } = await exec('git', ['--no-pager', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', ...args], {
      cwd: root, encoding: 'buffer', windowsHide: true, timeout: 30000, maxBuffer: MAX_TEXT + 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' }
    });
    return stdout;
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('Git is not installed or is not on PATH.');
    if (e.killed || e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('Git comparison exceeded the time or size limit. Narrow the comparison.');
    throw new Error('Git: ' + (e.stderr?.toString().trim() || e.message));
  }
}
module.exports = { git };
