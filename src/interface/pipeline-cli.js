'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
function main(args) {
  const [command = 'status', root = '.', ...flags] = args;
  const python = process.env.DEVKIT_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
  const argv = [...(python === 'py' ? ['-3'] : []), path.resolve(__dirname, '../../pipeline.py'), '--root', path.resolve(root), command, ...flags];
  return new Promise((resolve, reject) => {
    const child = spawn(python, argv, { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => { process.exitCode = code ?? 1; resolve({ passed: code === 0 }); });
  });
}
module.exports = { main };
