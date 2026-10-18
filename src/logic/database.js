'use strict';
const driver=require('../data/database/driver');
function connection(raw) {
  if(!raw || !['mysql','mariadb','postgres'].includes(raw.type))throw new Error('Choose mysql, mariadb or postgres');
  const c={type:raw.type,host:raw.host,port:Number(raw.port??(raw.type==='postgres'?5432:3306)),user:raw.user,
    database:raw.database||'',tls:raw.tls!==false,caPath:raw.caPath||'',timeout:Number(raw.timeout??15000),maxRows:Number(raw.maxRows??500)};
  for(const key of ['host','user','database','caPath'])if(typeof c[key]!=='string'||/[\x00-\x1f]/.test(c[key]))throw new Error('Invalid database connection '+key);
  if(!c.host || /[\s/@?#]/.test(c.host)||!c.user)throw new Error('Host and user are required; use a hostname, not a connection URL');
  if(!Number.isInteger(c.port)||c.port<1||c.port>65535)throw new Error('Invalid database port');
  if(!Number.isInteger(c.timeout)||c.timeout<1000||c.timeout>120000)throw new Error('Timeout must be 1000–120000 ms');
  if(!Number.isInteger(c.maxRows)||c.maxRows<1||c.maxRows>5000)throw new Error('Row limit must be 1–5000');
  return c;
}
function identifier(type,name) {
  if(typeof name!=='string'||!name||/[\x00-\x1f]/.test(name))throw new Error('Invalid SQL identifier');
  return type==='postgres'?'"'+name.replaceAll('"','""')+'"':'`'+name.replaceAll('`','``')+'`';
}
// Metadata SQL adapted from upstream MysqlDialect / PostgreSqlDialect; values
// are bound parameters rather than interpolated remote names.
function statement(c,action,args={}) {
  const pg=c.type==='postgres',p=pg?'$1':'?',q=pg?'$2':'?';
  const schema=args.schema||(pg?'public':c.database);
  if(['tables','columns','preview'].includes(action)&&!schema)throw new Error('Choose a database/schema before browsing');
  if(['columns','preview'].includes(action))identifier(c.type,args.table);
  if(action==='test')return ['SELECT 1 AS connected',[]];
  if(action==='databases')return [pg?'SELECT datname AS name FROM pg_database WHERE datistemplate = false ORDER BY datname':'SHOW DATABASES',[]];
  if(action==='schemas')return [pg?'SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name':'SHOW DATABASES',[]];
  if(action==='tables')return [`SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = ${p} ORDER BY table_name`,[schema]];
  if(action==='columns')return [`SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS default_value FROM information_schema.columns WHERE table_schema = ${p} AND table_name = ${q} ORDER BY ordinal_position`,[schema,args.table]];
  if(action==='preview')return ['SELECT * FROM '+identifier(c.type,schema)+'.'+identifier(c.type,args.table)+' LIMIT '+(c.maxRows+1),[]];
  if(action==='query') {
    if(typeof args.sql!=='string'||!args.sql.trim()||args.sql.length>1024*1024)throw new Error('Enter SQL (maximum 1 MiB)');
    if(!args.confirmed)throw new Error('SQL execution requires confirmation; CLI: --yes');
    return [args.sql,[]];
  }
  throw new Error('Unknown database action');
}
async function run(raw,password,action,args={},adapter=driver) {
  const c=connection(raw);const [sql,values]=statement(c,action,args);
  return adapter.execute(c,password,sql,values);
}
module.exports={connection,identifier,statement,run};
