#!/usr/bin/env node
'use strict';
const cli = require('./src/interface/cli');
if (require.main === module) Promise.resolve(cli.main()).catch(e => { console.error(e.message); process.exitCode = ['compare', 'git-compare'].includes(process.argv[2]) ? 2 : 1; });
module.exports = cli;
