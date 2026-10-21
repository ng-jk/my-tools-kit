import Parser = require('ftp/lib/parser');
import {FileStats,FileType} from './fileSystem';

// A 550 reply alone also means denied/unavailable. Only explicit missing-path
// wording is absence; remove the requested name before examining server text.
export function missingPathReply(error:any,path:string) {
  if(Number(error.code)!==550)return false;
  const name=path.split('/').pop()!;
  let text=String(error.message||'').replaceAll(path,'<path>');
  if(name)text=text.replaceAll(name,'<path>');
  text=text.trim().replace(/^550[ -]/,'').replace(/["']/g,'');
  return /^(?:<path>\s*[: -]\s*)?(?:no such file(?: or directory)?|file not found|path not found|not found|file does not exist|path does not exist|sorry, but that file doesnt exist)[.!\s]*$/i.test(text);
}
export function mlstMetadata(reply:string,path:string):FileStats|undefined {
  for(const line of reply.split(/\r?\n/)){
    const match=/^\s*((?:[A-Za-z0-9._-]+=[^;\r\n]*;)+) (.+)$/.exec(line);
    if(!match||match[2]!==path)continue;
    const facts=new Map(match[1].split(';').filter(Boolean).map(value=>{const i=value.indexOf('=');return [value.slice(0,i).toLowerCase(),value.slice(i+1)];}));
    const type=facts.get('type')?.toLowerCase(),mode=facts.get('unix.mode');
    // Unknown types (including possibly dereferenced symlinks) are never files.
    if(!['file','dir'].includes(type||'')||!mode||!/^0?[0-7]{3,4}$/.test(mode))return;
    const size=Number(facts.get('size')||0);if(!Number.isSafeInteger(size)||size<0)return;
    return {type:type==='dir'?FileType.Directory:FileType.File,mode:parseInt(mode,8),size,mtime:0,atime:0};
  }
}
export function statMetadata(reply:string,path:string):FileStats|undefined {
  const name=path.split('/').pop(),matches=[];
  for(const line of reply.split(/\r?\n/)){
    const entry=Parser.parseListEntry(line.trim());
    if(!entry||typeof entry!=='object'||(entry.name!==path&&entry.name!==name))continue;
    if(!['-','d','l'].includes(entry.type)||!entry.rights)return;
    const bits=(rights:string)=>[...rights].reduce((n,c)=>n+(c==='r'?4:c==='w'?2:c==='x'?1:0),0);
    const mode=(bits(entry.rights.user)<<6)|(bits(entry.rights.group)<<3)|bits(entry.rights.other);
    matches.push({type:entry.type==='-'?FileType.File:entry.type==='d'?FileType.Directory:FileType.SymbolicLink,mode,size:entry.size,mtime:entry.date.getTime(),atime:entry.date.getTime(),target:entry.target});
  }
  return matches.length===1?matches[0]:undefined;
}
