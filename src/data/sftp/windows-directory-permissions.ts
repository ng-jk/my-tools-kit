import {execFile,spawn,ChildProcessWithoutNullStreams} from 'child_process';
import {createInterface} from 'readline';
import {promisify} from 'util';
const run = promisify(execFile);
// Constant script; the filesystem path is passed as data, never interpolated into code.
const script = `
$ErrorActionPreference = 'Stop'
$directory = $env:DEVKIT_ACL_DIRECTORY
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
foreach ($identity in @($sid, $system)) {
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.SetAccessRule($rule)
}
[System.IO.Directory]::SetAccessControl($directory, $acl)
$actual = [System.IO.Directory]::GetAccessControl($directory)
if (-not $actual.AreAccessRulesProtected) { throw 'Directory ACL inheritance remains enabled' }
$rules = $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
$ownerAllowed = $false
foreach ($rule in $rules) {
  if ($rule.IdentityReference.Value -notin @($sid.Value, $system.Value) -or $rule.AccessControlType -ne 'Allow' -or $rule.IsInherited) { throw 'Unexpected directory access rule' }
  if ($rule.IdentityReference.Value -eq $sid.Value -and ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) { $ownerAllowed = $true }
}
if (-not $ownerAllowed) { throw 'Directory owner lacks access' }
`;
export async function protectWindowsDirectory(directory: string) {
  await run('powershell.exe', ['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {windowsHide:true,timeout:30000,env:{...process.env,DEVKIT_ACL_DIRECTORY:directory}});
}

const fileScript = `
$ErrorActionPreference = 'Stop'
$file = $env:DEVKIT_ACL_FILE
$destination = $env:DEVKIT_ACL_DESTINATION
$original = $null
if ([System.IO.File]::Exists($destination)) {
  try { $original = [System.IO.File]::GetAccessControl($destination) } catch [System.IO.FileNotFoundException] { $original = $null }
}
if ($null -ne $original) {
  $acl = [System.Security.AccessControl.FileSecurity]::new()
  $acl.SetSecurityDescriptorSddlForm($original.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access), [System.Security.AccessControl.AccessControlSections]::Access)
} else {
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = [System.Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($sid, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $acl.SetAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow'))
  }
}
$expected = $acl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)
[System.IO.File]::SetAccessControl($file, $acl)
$actual = [System.IO.File]::GetAccessControl($file)
# Windows may add the auto-inherited flag while persisting an otherwise identical DACL.
$observed = $actual.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)
if ($actual.AreAccessRulesProtected -ne $acl.AreAccessRulesProtected -or ($observed -replace '^D:[A-Z]*','') -ne ($expected -replace '^D:[A-Z]*','')) { throw 'Staging file ACL verification failed' }
`;
export async function protectWindowsStagingFile(file: string, destination: string) {
  await run('powershell.exe', ['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(fileScript,'utf16le').toString('base64')],
    {windowsHide:true,timeout:30000,env:{...process.env,DEVKIT_ACL_FILE:file,DEVKIT_ACL_DESTINATION:destination}});
}

const treeScript = script + `
$fileAcl = [System.Security.AccessControl.FileSecurity]::new()
$fileAcl.SetOwner($sid)
$fileAcl.SetAccessRuleProtection($true, $false)
foreach ($identity in @($sid, $system)) { $fileAcl.SetAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow')) }
$queue = [System.Collections.Generic.Queue[string]]::new()
$queue.Enqueue($directory)
while ($queue.Count -gt 0) {
  $parent = $queue.Dequeue()
  foreach ($entry in [System.IO.Directory]::GetFileSystemEntries($parent)) {
    $attributes = [System.IO.File]::GetAttributes($entry)
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Mirror repository contains a link' }
    if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
      $entryAcl = [System.Security.AccessControl.DirectorySecurity]::new()
      $entryAcl.SetSecurityDescriptorSddlForm($acl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access), [System.Security.AccessControl.AccessControlSections]::Access)
      [System.IO.Directory]::SetAccessControl($entry, $entryAcl)
      $value = [System.IO.Directory]::GetAccessControl($entry)
      $queue.Enqueue($entry)
    } else {
      $entryAcl = [System.Security.AccessControl.FileSecurity]::new()
      $entryAcl.SetSecurityDescriptorSddlForm($fileAcl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access), [System.Security.AccessControl.AccessControlSections]::Access)
      [System.IO.File]::SetAccessControl($entry, $entryAcl)
      $value = [System.IO.File]::GetAccessControl($entry)
    }
    if (-not $value.AreAccessRulesProtected) { throw 'Mirror ACL inheritance remains enabled' }
    foreach ($rule in $value.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {
      if ($rule.IdentityReference.Value -notin @($sid.Value,$system.Value) -or $rule.AccessControlType -ne 'Allow' -or $rule.IsInherited) { throw 'Unexpected mirror access rule' }
    }
  }
}
`;
export async function protectWindowsTree(directory: string) {
  await run('powershell.exe', ['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(treeScript,'utf16le').toString('base64')],
    {windowsHide:true,timeout:30000,env:{...process.env,DEVKIT_ACL_DIRECTORY:directory}});
}

// One fixed-code worker per backup batch; each file still receives the same
// ACL establishment and verification. Requests are JSON data, never code.
export function createWindowsStagingBatch() {
  const requests=new Map<number,{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;kind:string}>();
  let child:ChildProcessWithoutNullStreams|undefined,next=0,closed=false,failed:Error|undefined;
  let exited:Promise<void>=Promise.resolve();
  const fail=(error:Error)=>{failed=failed||error;for(const request of requests.values()){clearTimeout(request.timer);request.reject(failed);}requests.clear();child?.kill();};
  const start=()=>{
    const body=fileScript.replace('$file = $env:DEVKIT_ACL_FILE','$file = [string]$request.file').replace('$destination = $env:DEVKIT_ACL_DESTINATION','$destination = [string]$request.destination');
    const treeBody=treeScript.replace('$directory = $env:DEVKIT_ACL_DIRECTORY','$directory = [string]$request.directory');
    const worker=`[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    if ($request.kind -eq 'tree') {
      ${treeBody}
    } elseif ($request.kind -eq 'file') {
      ${body}
    } else { throw 'Invalid staging ACL request' }
    [Console]::WriteLine((@{id=$request.id;ok=$true} | ConvertTo-Json -Compress))
  } catch {
    $failure = $_.Exception
    while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
    $code = 'ACL_VERIFICATION_FAILED'
    if ($failure -is [System.UnauthorizedAccessException]) { $code = 'EACCES' }
    elseif ($failure -is [System.IO.FileNotFoundException] -or $failure -is [System.IO.DirectoryNotFoundException]) { $code = 'ENOENT' }
    [Console]::WriteLine((@{id=$request.id;ok=$false;code=$code} | ConvertTo-Json -Compress))
  }
}`;
    child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(worker,'utf16le').toString('base64')],{windowsHide:true,stdio:'pipe'});
    const lines=createInterface({input:child.stdout});
    lines.on('error',()=>fail(new Error('Staging ACL worker output failed')));
    child.stdout.on('error',()=>fail(new Error('Staging ACL worker output failed')));
    child.stderr.on('error',()=>fail(new Error('Staging ACL worker diagnostic pipe failed')));
    lines.on('line',line=>{
      try{
        const result=JSON.parse(line),request=requests.get(result.id);
        if(!request||typeof result.ok!=='boolean')throw new Error('Invalid staging ACL worker response');
        requests.delete(result.id);clearTimeout(request.timer);
        if(result.ok)request.resolve();else {
          const code=['EACCES','ENOENT','ACL_VERIFICATION_FAILED'].includes(result.code)?result.code:'ACL_VERIFICATION_FAILED';
          const problem=code==='EACCES'?'Access denied; check local directory ownership and permissions.':code==='ENOENT'?'A backup file or directory was not found.':'The required access rules could not be verified.';
          request.reject(Object.assign(new Error((request.kind==='tree'?'Backup repository':'Staging file')+' ACL verification failed ('+code+'). '+problem),{code}));
        }
      }catch{fail(new Error('Invalid staging ACL worker response'));}
    });
    child.stderr.resume();
    child.stdin.on('error',()=>fail(new Error('Staging ACL worker input failed')));
    child.on('error',()=>fail(new Error('Cannot start staging ACL worker')));
    exited=new Promise(resolve=>child!.once('close',()=>{lines.close();if(requests.size||!closed)fail(new Error('Staging ACL worker exited before completion'));resolve();}));
  };
  const request=(payload:{kind:string;file?:string;destination?:string;directory?:string}):Promise<void>=>{
    if(closed||failed)return Promise.reject(failed||new Error('Staging ACL batch is closed'));
    if(!child)start();
    const id=++next;
    return new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>fail(new Error('Staging ACL worker timed out')),30000);
      requests.set(id,{resolve,reject,timer,kind:payload.kind});child!.stdin.write(JSON.stringify({id,...payload})+'\n');
    });
  };
  return {
    protect:(file:string,destination:string)=>request({kind:'file',file,destination}),
    protectTree:(directory:string)=>request({kind:'tree',directory}),
    close:async()=>{
      if(closed)return exited;closed=true;
      if(requests.size)fail(new Error('Staging ACL batch closed with pending files'));
      child?.stdin.end();
      const timer=setTimeout(()=>child?.kill(),5000);
      try{await exited;}finally{clearTimeout(timer);}
    },
  };
}
