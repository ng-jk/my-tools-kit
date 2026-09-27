'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['repositories', 'node_modules', '.npm-cache', '.devkit', '.git', 'dist'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.js')) { const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr); count++; }
    else if (file.endsWith('.json') || file.endsWith('.code-workspace')) JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}
walk(root);
console.log(`Syntax checked ${count} JavaScript files and all JSON files.`);
