'use strict';
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const root = path.resolve(__dirname, '..');
  const dependencies = new Set();
  for (const [entry, name] of [['src/interface/sftp/extension.ts', 'extension'], ['src/logic/sftp/engine.ts', 'engine'], ['src/data/sftp/watch-match.js', 'watch-match']]) {
    const result = await esbuild.build({ absWorkingDir: root, entryPoints: [entry], outfile: 'build/sftp/' + name + '.js',
      platform: 'node', target: 'node20', format: 'cjs', bundle: true, sourcemap: false, metafile: true,
      external: ['vscode', '*.node', 'cpu-features'], logLevel: 'warning',
      tsconfigRaw: { compilerOptions: { esModuleInterop: false, useDefineForClassFields: false } } });
    if (name === 'engine' && Object.keys(result.metafile.inputs).some(file => file.startsWith('src/interface/'))) throw new Error('Engine imports interface code');
    for (const input of Object.keys(result.metafile.inputs).filter(file => file.includes('node_modules/'))) {
      let directory = path.dirname(path.join(root, input));
      while (directory.startsWith(root) && !fs.existsSync(path.join(directory, 'package.json'))) directory = path.dirname(directory);
      if (directory.startsWith(root)) dependencies.add(directory);
    }
    fs.mkdirSync(path.join(root, 'dist'), {recursive:true});
    fs.writeFileSync(path.join(root, 'dist/sftp-' + name + '-metafile.json'), JSON.stringify(result.metafile, null, 2));
  }
  const notices = [...dependencies].sort().map(directory => {
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const licenses = fs.readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name) && fs.statSync(path.join(directory, name)).isFile());
    return `${pkg.name}@${pkg.version} (${pkg.license || 'see package'})\n` + licenses.map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n');
  });
  fs.writeFileSync(path.join(root, 'build/sftp/THIRD-PARTY-LICENSES.txt'), notices.join('\n\n----------------\n\n'));
  console.log('Bundled SFTP UI and headless engine');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
