'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const MAX_TEXT = 20 * 1024 * 1024;
function environment() {
  // A comparison is scoped to its explicit cwd, never an inherited Git context
  // from a terminal, hook, task or another extension.
  const context=new Set(['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_CEILING_DIRECTORIES','GIT_DISCOVERY_ACROSS_FILESYSTEM','GIT_NAMESPACE','GIT_PREFIX','GIT_SHALLOW_FILE']);
  return {...Object.fromEntries(Object.entries(process.env).filter(([key])=>!context.has(key.toUpperCase()))),
    GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_LITERAL_PATHSPECS:'1'};
}
async function git(root, args) {
  try {
    const { stdout } = await exec('git', ['--no-pager', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', ...args], {
      cwd: root, encoding: 'buffer', windowsHide: true, timeout: 30000, maxBuffer: MAX_TEXT + 1024 * 1024,
      env: environment()
    });
    return stdout;
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('Git is not installed or is not on PATH.');
    if (e.killed || e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('Git comparison exceeded the time or size limit. Narrow the comparison.');
    const detail=e.stderr?.toString().trim() || e.message;
    const error=new Error('Git: '+detail);
    error.kind=/not a git repository/i.test(detail)?'not-repository':undefined;
    throw error;
  }
}
module.exports = { git };
