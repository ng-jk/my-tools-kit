'use strict';
const fs=require('node:fs');
const path=require('node:path');
async function readConfiguration(file) {return JSON.parse(await fs.promises.readFile(file,'utf8'));}
async function ensureConfiguration(file,value) {
  await fs.promises.mkdir(path.dirname(file),{recursive:true});
  try {await fs.promises.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
  catch(error) {if(error.code!=='EEXIST')throw error;}
  return file;
}
function configurationExists(file) {return fs.existsSync(file);}
module.exports={readConfiguration,ensureConfiguration,configurationExists};
