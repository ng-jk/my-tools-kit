'use strict';
const http=require('node:http'),https=require('node:https');
const {transport}=require('./http');
const {ntlm}=require('../../build/sftp/api-auth');
async function ntlmTransport(url,init,options,auth) {
  if(!auth.username||typeof auth.password!=='string')throw new Error('NTLM authentication requires username and password fields');
  const agent=new (url.protocol==='https:'?https.Agent:http.Agent)({keepAlive:true,maxSockets:1});
  const start=Date.now(),timeout=options.timeout||30000;
  try {
    const firstHeaders={...init.headers,authorization:ntlm.createType1Message({...auth}),connection:'keep-alive'};
    delete firstHeaders['content-length'];
    const first=await transport(url,{...init,headers:firstHeaders,body:undefined},{...options,agent});
    if(first.status!==401)return first;
    let error;const challenge=ntlm.parseType2Message(String(first.headers['www-authenticate']||''),e=>{error=e;});
    if(error||!challenge||(challenge.negotiateFlags&0x80000)===0||!challenge.targetInfo?.length)throw new Error('NTLMv2 challenge with extended security and target information is required');
    const remaining=timeout-(Date.now()-start);if(remaining<=0)throw new Error('Request timeout');
    return await transport(url,{...init,headers:{...init.headers,authorization:ntlm.createType3Message(challenge,{...auth})}},{...options,agent,expectedSocket:first.socket,timeout:remaining});
  }finally{agent.destroy();}
}
module.exports={ntlmTransport};
