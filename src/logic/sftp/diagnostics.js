'use strict';
function connectionFailure(error, config) {
  const code=error?.code;
  const text=String(error?.message || '');
  let problem;
  if (['ENOTFOUND','EAI_AGAIN'].includes(code)) problem='Host name could not be resolved. Check host and DNS.';
  else if(code==='ECONNREFUSED') problem='Host refused the connection. Check port and whether FTP/SSH is running.';
  else if(['ETIMEDOUT','ENETUNREACH','EHOSTUNREACH'].includes(code)||/timed? ?out/i.test(text)) problem='Host connection timed out or is unreachable. Check network, firewall and port.';
  else if(code===530||code==='530'||error?.level==='client-authentication'||/authentication|all configured authentication|login incorrect|not logged in/i.test(text)) problem='Authentication rejected. Check username and password, or the SSH key/passphrase and account access. The server may not identify which credential is incorrect.';
  else if(code==='ENOENT') problem='A local SSH key or connection file was not found. Check privateKeyPath and SSH configuration paths.';
  else if(/host key/i.test(text)) problem='SSH host key verification failed. Verify the server fingerprint and known-hosts or pin settings.';
  else if(/certificate|self.signed|tls|ssl/i.test(text)) problem='TLS certificate verification or negotiation failed. Check the server certificate and TLS settings.';
  else return error; // Preserve cancellation and other existing specific diagnostics.
  const host=typeof config.host==='string'&&config.host.length<254&&/^[a-zA-Z0-9.:[\]_-]+$/.test(config.host)?config.host:undefined;
  const endpoint=host?' to '+host+(Number.isInteger(config.port)?':'+config.port:''):'';
  const result=new Error(`${String(config.protocol || 'sftp').toUpperCase()} connection${endpoint}: ${problem}`);
  if(code!==undefined)result.code=code;
  return result;
}
async function requireDiffFile(fs, file, side) {
  try { return await fs.lstat(file); }
  catch(error) {
    if(error.code==='ENOENT'||error.code===2) throw Object.assign(new Error(`Diff: file not found ${side==='local'?'locally':'on server'}: ${file}`),{code:error.code});
    if(['EACCES','EPERM',3,550].includes(error.code)) throw Object.assign(new Error(`Diff: cannot access ${side} file (permission denied or server path unavailable): ${file}`),{code:error.code});
    throw error;
  }
}
function uploadMode(mode, explicit) {
  if(explicit!==undefined && explicit!==null) {
    if(!/^[0-7]{3,4}$/.test(String(explicit)) || parseInt(String(explicit),8)>0o777) throw new Error('Invalid filePerm: use octal digits such as 600, 640 or 644 (no special permission bits).');
    return parseInt(String(explicit),8);
  }
  // Do not broaden group/other access or carry special bits from the source.
  return ((typeof mode==='number'?mode:0o600)&0o777)|0o200;
}
module.exports={connectionFailure,requireDiffFile,uploadMode};
