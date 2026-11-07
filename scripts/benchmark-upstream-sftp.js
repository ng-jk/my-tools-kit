"use strict";
// Build a loopback-only comparison harness from the recorded upstream source.
// UI logging/document hooks are stubbed; transfer, FTP and mirror code are upstream.
const path=require('node:path'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),upstream=path.join(root,'repositories/vscode-sftp/src');
const entry=`
import * as fs from 'fs';import * as os from 'os';import * as path from 'path';import * as git from 'isomorphic-git';
import {FTPFileSystem,LocalFileSystem} from './repositories/vscode-sftp/src/core/fs';
import {transfer,TransferDirection} from './repositories/vscode-sftp/src/fileHandlers/transfer/transfer';
import Mirror from './repositories/vscode-sftp/src/core/mirror';
export const benchmarkSource='upstream';
export function createSession(root,config){
 if(config.protocol!=='ftp'||config.host!=='127.0.0.1'||config.username!=='fixture'||config.password!=='fixture')throw new Error('Upstream comparison is restricted to loopback fixtures');
 const options={...config,connectTimeout:10000,debug:()=>{}},remote=new FTPFileSystem(path.posix,{clientOption:options}),local=new LocalFileSystem(path);
 const mirrorPath=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-upstream-mirror-')),mirror=new Mirror(mirrorPath);let connected;
 return {root,remote,local,mirror,mirrorPath,uploaded:new Set(),config:options,service:{getRemoteFileSystem:()=>connected||(connected=remote.connect(options,{askForPasswd:async()=>{throw new Error('No prompts in benchmark');}}).then(()=>remote)),dispose:()=>{remote.end();const target=path.resolve(mirrorPath);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('devkit-upstream-mirror-'))throw new Error('Invalid benchmark cleanup directory');fs.rmSync(target,{recursive:true,force:true});}}};
}
export async function operate(session,action,relative){
 if(action!=='upload')throw new Error('Upstream comparison supports upload only');
 const remote=await session.service.getRemoteFileSystem(),tasks=[];
 await transfer({srcFsPath:path.join(session.root,relative),targetFsPath:path.posix.join('/',relative.replaceAll('\\\\','/')),srcFs:session.local,targetFs:remote,transferDirection:TransferDirection.LOCAL_TO_REMOTE,transferOption:{useTempFile:true,perserveTargetMode:true}},task=>tasks.push(task));
 await session.mirror.backupBatch(tasks.map(task=>({relPath:path.relative(session.root,task.localFsPath),remotePath:task.targetFsPath,remoteFs:remote})),{concurrency:4});
 for(const task of tasks)if(session.uploaded.has(task.targetFsPath)){const oid=await git.resolveRef({fs,dir:session.mirrorPath,ref:'HEAD'}),saved=await git.readBlob({fs,dir:session.mirrorPath,oid,filepath:path.relative(session.root,task.localFsPath).split(path.sep).join('/')});if(!Buffer.from(saved.blob).equals(fs.readFileSync(task.localFsPath)))throw new Error('Upstream benchmark backup verification failed');}
 for(const task of tasks){await task.run();session.uploaded.add(task.targetFsPath);}
 return {passed:true,transferred:tasks.length};
}`;
const core=`export * from './fs';export * from './transferTask';export {default as TransferTask} from './transferTask';import * as fileOperations from './fileBaseOperations';export {fileOperations};`;
esbuild.build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root,loader:'ts'},outfile:'dist/upstream-benchmark-engine.js',bundle:true,platform:'node',target:'node20',format:'cjs',external:['*.node','cpu-features'],tsconfigRaw:{compilerOptions:{esModuleInterop:false,useDefineForClassFields:false}},plugins:[{name:'headless-upstream-hooks',setup(build){
 build.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'benchmark-stub'}));
 build.onResolve({filter:/(?:logger|host)$/},args=>args.resolveDir.startsWith(upstream)?{path:args.path.endsWith('logger')?'logger':'host',namespace:'benchmark-stub'}:undefined);
 build.onLoad({filter:/.*/,namespace:'benchmark-stub'},args=>({contents:args.path==='logger'?`export default {trace(){},debug(){},info(){},warn(){},error(){},critical(){}};`:args.path==='host'?`export const getOpenTextDocuments=()=>[];`:`export const window={showErrorMessage(){throw new Error('Unexpected UI in benchmark');}};`,loader:'js'}));
 build.onLoad({filter:/[\\/](?:ftpFileSystem|ftpClient)\.ts$/},args=>args.path.startsWith(upstream)?{contents:require('node:fs').readFileSync(args.path,'utf8').replace("import * as PQueue from 'p-queue';","import PQueue from 'p-queue';").replace("import * as Client from 'ftp';","import Client from 'ftp';"),loader:'ts',resolveDir:path.dirname(args.path)}:undefined);
 build.onLoad({filter:/[\\/]core[\\/]index\.ts$/},args=>args.path.startsWith(upstream)?{contents:core,loader:'ts',resolveDir:path.dirname(args.path)}:undefined);
}}]}).then(()=>process.stdout.write('Built loopback-only upstream data/logic benchmark harness\n')).catch(error=>{console.error(error);process.exitCode=1;});
