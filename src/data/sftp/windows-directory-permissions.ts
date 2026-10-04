import {execFile} from 'child_process';
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
