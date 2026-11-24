function hops(value:any):any[]{
 if(value===undefined)return [];
 if(!value||typeof value!=='object')throw Object.assign(new Error('An explicit SSH hop must be a nonempty connection object or array'),{routeType:'nonempty_connection_route_required',routePath:'hop'});
 if(Array.isArray(value)){
  if(!value.length)throw Object.assign(new Error('An explicit SSH hop list cannot be empty; omit hop for a direct connection'),{routeType:'nonempty_connection_route_required',routePath:'hop'});
  return value;
 }
 if(!Object.keys(value).length)throw Object.assign(new Error('An explicit SSH hop object requires a host'),{routeType:'host_required',routePath:'hop.host'});
 return [value];
}

// Terminal nesting was never resolved by the transport. Reject it before any
// SSH connection instead of silently selecting an intermediate host.
export function sshDestination(option:any):{host:string;port:number;username?:string;sudo:boolean}{
 const pending=[option],seen=new Set();
 while(pending.length){
  const node=pending.pop();if(!node||typeof node!=='object'||Array.isArray(node))throw Object.assign(new Error('Each SSH hop must be a connection object'),{routeType:'connection_object_required',routePath:'hop'});
  if(seen.has(node))throw Object.assign(new Error('Cyclic SSH hops are unsupported'),{routeType:'cyclic_hops',routePath:'hop'});seen.add(node);
  if(typeof node.host!=='string'||!node.host.trim()||/[\r\n\0]/.test(node.host))throw Object.assign(new Error('Every SSH route endpoint requires an explicit host'),{routeType:'host_required',routePath:node===option?'host':'hop.host'});
  if(node.username!==undefined&&(typeof node.username!=='string'||!node.username.trim()))throw Object.assign(new Error('Configured SSH usernames must be nonempty strings'),{routeType:'nonempty_username_required',routePath:node===option?'username':'hop.username'});
  if(node.hostname!==undefined&&node.hostname!==node.host)throw Object.assign(new Error('Conflicting SSH hostname alias; use host only'),{routeType:'use_host_only',routePath:node===option?'hostname':'hop.hostname'});
  if(node.port!==undefined&&(!Number.isInteger(node.port)||node.port<1||node.port>65535))throw Object.assign(new Error('SSH route ports must be integers from 1 to 65535'),{routeType:'port_1_to_65535_required',routePath:node===option?'port':'hop.port'});
  const chain=hops(node.hop);
  if(chain.length&&hops(chain[chain.length-1]?.hop).length)throw Object.assign(new Error('Nested final SSH hops are unsupported; flatten the destination hop chain before connecting'),{routeType:'flatten_destination_hops',routePath:'hop'});
  pending.push(...chain);
 }
 const chain=hops(option.hop),last=chain.length?chain[chain.length-1]:option;
 return {host:last.host,port:last.port===undefined?22:last.port,username:last.username,sudo:(last.sudo===undefined?option.sudo:last.sudo)===true};
}
