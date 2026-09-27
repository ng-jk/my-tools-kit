#!/usr/bin/env node
'use strict';
const { main } = require('./src/interface/pipeline-cli');
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main };
