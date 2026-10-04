'use strict';
const fs=require('node:fs');
const {spawn}=require('node:child_process');
function watchLocalDirectory(root,callback) {return fs.watch(root,{recursive:true},callback);}
function runSsh(args) {return new Promise((resolve,reject)=>{const child=spawn('ssh',args,{stdio:'inherit',shell:false});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('ssh exited '+code)));});}
module.exports={watchLocalDirectory,runSsh};
