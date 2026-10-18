'use strict';
// Adapted from cweijan/vscode-database-client MysqlConnection and
// PostgreSqlConnection (MIT). See vendor/database-client/provenance.json.
const fs=require('node:fs');
const tls=require('node:tls');
const net=require('node:net');
function sslOptions(config) {
  return config.tls===false?undefined:{rejectUnauthorized:true,verifyIdentity:true,minVersion:'TLSv1.2',
    ...(!net.isIP(config.host)?{servername:config.host}:{}),
    ...(config.caPath?{ca:fs.readFileSync(config.caPath)}:{})};
}
function failure(error) {
  const code=String(error?.code||'').replace(/[^A-Z0-9_]/g,'').slice(0,48);
  // Server and driver messages may contain SQL, connection strings or secrets.
  return new Error('Database operation failed'+(code?' ('+code+')':'')+'. Check host, credentials, TLS certificate, permissions and SQL. Execution outcome may be uncertain; verify server state before retrying writes.');
}
async function execute(config,password,text,values=[]) {
  const ssl=sslOptions(config);
  return new Promise((resolve,reject)=>{
    let client,done=false,bytes=0,truncated=false,completedResult;const rows=[],columns=[];let affectedRows=0;
    const pgRows=new WeakMap();
    const mysqlSets=new Map();
    const finish=(error)=>{
      if(done)return;done=true;clearTimeout(timer);
      try {if(config.type==='postgres')client?.end()?.catch(()=>{});else client?.destroy();}catch{}
      if(error)reject(failure(error));else resolve(completedResult||{columns,rows,affectedRows,truncated});
    };
    const timer=setTimeout(()=>finish({code:'QUERY_TIMEOUT'}),config.timeout);
    const row=(value,fields,target=rows)=>{
      if(done)return;
      if(!columns.length && fields)columns.push(...fields.map(f=>f.name));
      if(truncated||rows.length===config.maxRows){truncated=true;return;}
      const serialized=JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
      bytes+=Buffer.byteLength(serialized);
      if(bytes>8*1024*1024){truncated=true;return;}
      const copied=JSON.parse(serialized);rows.push(copied);if(target!==rows)target.push(copied);
    };
    try {
      if(config.type==='postgres') {
        const pg=require('pg');
        client=new pg.Client({host:config.host,port:config.port,user:config.user,password,database:config.database,
          ssl,connectionTimeoutMillis:config.timeout,statement_timeout:config.timeout});
        client.on('error',error=>finish(error));
        client.connect().then(()=>{
          if(done)return;
          const query=new pg.Query({text,values,rowMode:'array'});
          query.on('row',(value,result)=>{let target=pgRows.get(result);if(!target){target=[];pgRows.set(result,target);}row(value,result.fields,target);});
          query.on('error',error=>finish(error));
          query.on('end',result=>{
            const sets=(Array.isArray(result)?result:[result]).map(r=>({columns:(r.fields||[]).map(f=>f.name),rows:pgRows.get(r)||[],affectedRows:r.rowCount||0}));
            completedResult=sets.length===1?{...sets[0],truncated}:{columns:[],rows:[],affectedRows:sets.reduce((n,r)=>n+r.affectedRows,0),truncated,results:sets};finish();
          });
          client.query(query);
        },error=>finish(error));
      } else {
        const mysql=require('mysql2');
        client=mysql.createConnection({host:config.host,port:config.port,user:config.user,password,database:config.database||undefined,
          ssl,connectTimeout:config.timeout,multipleStatements:false,rowsAsArray:true,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,
          flags:['-LOCAL_FILES'],infileStreamFactory:()=>{throw new Error('Local infile is disabled');}});
        if(ssl && net.isIP(config.host)) {
          // mysql2 omits SNI for IP addresses; verify the IP SAN explicitly
          // after chain validation and before its authentication callback.
          const startTLS=client.startTLS.bind(client);
          client.config.ssl.verifyIdentity=false;
          client.startTLS=callback=>startTLS(error=>{
            if(error)return callback(error);
            try {callback(tls.checkServerIdentity(config.host,client.stream.getPeerCertificate(true)));}
            catch(certificateError){callback(certificateError);}
          });
        }
        client.on('error',error=>finish(error));
        const query=values.length?client.execute({sql:text,values,timeout:config.timeout}):client.query({sql:text,timeout:config.timeout});
        const group=index=>{if(!mysqlSets.has(index))mysqlSets.set(index,{columns:[],rows:[],affectedRows:0});return mysqlSets.get(index);};
        query.on('fields',(fields,index=0)=>{const names=(fields||[]).map(f=>f.name);group(index).columns=names;if(!columns.length)columns.push(...names);});
        query.on('result',(value,index=0)=>{const set=group(index);if(Array.isArray(value))row(value,undefined,set.rows);else set.affectedRows=value.affectedRows||0;});
        query.on('error',error=>finish(error));query.on('end',()=>{const sets=[...mysqlSets.values()];completedResult=sets.length===1?{...sets[0],truncated}:{columns:[],rows:[],affectedRows:sets.reduce((n,r)=>n+r.affectedRows,0),truncated,results:sets};finish();});
      }
    }catch(error){finish(error);}
  });
}
module.exports={execute,sslOptions};
