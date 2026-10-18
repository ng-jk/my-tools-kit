'use strict';
const {readJson,readBuffer}=require('../data/files');
const {connection,run}=require('../../build/sftp/database');
async function main(args) {
  if(!args.length||args[0]==='--help'){console.log('devkit database test|databases|schemas|tables|columns|preview|query --config connection.json [--schema name] [--table name] [--filter SQL-LIKE-pattern] [--sql-file query.sql --yes]\nConfig: type,host,port,user,database,tls,caPath,passwordEnv. Passwords come only from the named environment variable. TLS defaults on. Plaintext connections require --allow-plaintext. Query results are printed to stdout; SQL may modify data.');return;}
  const [action,...rest]=args,flags={};
  for(let i=0;i<rest.length;i++) {
    const key=rest[i];if(['--yes','--allow-plaintext'].includes(key))flags[key]=true;
    else if(['--config','--schema','--table','--sql-file','--filter'].includes(key)&&rest[i+1]&&!rest[i+1].startsWith('--'))flags[key]=rest[++i];
    else throw new Error('Invalid database option');
  }
  if(!flags['--config'])throw new Error('--config is required');
  const raw=readJson(flags['--config']);
  if(Object.keys(raw).some(k=>/password|secret/i.test(k)&&k!=='passwordEnv'))throw new Error('Keep credentials out of config; use passwordEnv');
  const c=connection(raw);if(!c.tls&&!flags['--allow-plaintext'])throw new Error('Plaintext database transport requires --allow-plaintext');
  if(raw.passwordEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.passwordEnv))throw new Error('Invalid passwordEnv');
  const password=raw.passwordEnv?process.env[raw.passwordEnv]:undefined;
  if(raw.passwordEnv&&password===undefined)throw new Error('The configured password environment variable is not set');
  const result=await run(c,password,action,{filter:flags['--filter'],schema:flags['--schema'],table:flags['--table'],sql:flags['--sql-file']?readBuffer(flags['--sql-file']).toString('utf8'):undefined,confirmed:!!flags['--yes']});
  console.log(JSON.stringify(result));
}
module.exports={main};
