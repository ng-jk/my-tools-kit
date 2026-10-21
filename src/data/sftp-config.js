'use strict';
const fs=require('node:fs');
const path=require('node:path');
async function readConfiguration(file) {
  let content;
  try {content=await fs.promises.readFile(file,'utf8');}
  catch(error) {throw Object.assign(new Error((error.code==='ENOENT'?'Configuration file does not exist':error.code==='EACCES'||error.code==='EPERM'?'Configuration file cannot be read (permission denied)':'Configuration file could not be read')+': '+file),{code:error.code});}
  try {return JSON.parse(content);}
  catch {throw new Error('Configuration file contains invalid JSON: '+file+'. Fix JSON syntax (no comments or trailing commas).');}
}
async function ensureConfiguration(file,value) {
  await fs.promises.mkdir(path.dirname(file),{recursive:true});
  try {await fs.promises.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
  catch(error) {if(error.code!=='EEXIST')throw error;}
  return file;
}
function configurationExists(file) {return fs.existsSync(file);}
function inspectConfiguration(file) {
  let content;
  try {content=fs.readFileSync(file,'utf8');}
  catch(error) {return {problem:error.code==='ENOENT'?'Configuration file does not exist':error.code==='EACCES'||error.code==='EPERM'?'Configuration file cannot be read (permission denied)':'Configuration file could not be read'};}
  try {return {value:JSON.parse(content)};}
  catch {return {problem:'Configuration file contains invalid JSON. Fix JSON syntax (no comments or trailing commas)'};}
}
module.exports={readConfiguration,ensureConfiguration,configurationExists,inspectConfiguration};
