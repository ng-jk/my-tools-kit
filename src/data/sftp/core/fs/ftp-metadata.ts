import Parser = require('ftp/lib/parser');

// A 550 reply alone also means denied/unavailable. Only explicit missing-path
// wording is absence; remove the requested name before examining server text.
export function missingPathReply(error:any,path:string) {
  if(Number(error.code)!==550)return false;
  let text=String(error.message||'').trim().replace(/^550[ -]/,'');
  const names=[path,path.split('/').pop()!].filter(Boolean);
  for(const name of names){
    // Strip only an explicitly delimited echo, never words inside a diagnostic.
    for(const prefix of [name+':',"'"+name+"':",'"'+name+'":']){
      if(text.startsWith(prefix)){text=text.slice(prefix.length).trim();break;}
    }
  }
  if(names.some(name=>text===name||text==="'"+name+"'"||text==='"'+name+'"'))return false;
  text=text.replace(/["']/g,'');
  return /^(?:no such file(?: or directory)?|file not found|path not found|not found|file does not exist|path does not exist|sorry, but that file doesnt exist)[.!\s]*$/i.test(text);
}
// These replies can establish presence, but may describe a link referent.
// Never return them as lstat data for backup or ancestor traversal.
export function mlstReportsPresence(reply:string,path:string):boolean {
  return reply.split(/\r?\n/).some(line=>{
    const match=/^\s*((?:[A-Za-z0-9._-]+=[^;\r\n]*;)+) (.+)$/.exec(line);
    return !!match&&match[2]===path&&/(?:^|;)type=/i.test(match[1]);
  });
}
export function statReportsPresence(reply:string,path:string):boolean {
  const name=path.split('/').pop();
  return reply.split(/\r?\n/).some(line=>{
    const entry=Parser.parseListEntry(line.trim());
    return !!entry&&typeof entry==='object'&&(entry.name===path||entry.name===name);
  });
}
