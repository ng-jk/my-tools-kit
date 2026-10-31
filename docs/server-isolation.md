# FTP/SFTP server isolation

Use **SFTP: Check Server Isolation** in VS Code. Select the connection/context/profile; duplicate names are distinguished by host/port and workspace/context. Connection establishment and metadata inspection both show progress. The command opens a read-only report and changes no files or server settings. Terminal equivalent:

```sh
node cli.js sftp isolation . --context production --profile live
```

Omit context/profile when your configuration does not use them. The terminal returns exit 0 for protected directory metadata, exit 1 for an unsafe or unverifiable tree. It reports the host/port, workspace/context/profile, remote path and reason without credentials. Upload, sync-up, create, rename and delete use the same checks. Read-only browsing/download is not gated by the mutation isolation policy.

A passing check verifies metadata only. FTP/SFTP do not provide a trustworthy jail-status query. It does not establish OS chroot, ACLs, mount policy or protection from a privileged administrator. No workspace flag can certify or bypass these requirements.

## If you cannot edit the server

No edit is needed if the hosting provider already supplies a protected account tree with sufficient metadata. Set remotePath to the account-visible project path (often /project inside a jail), then run the diagnostic. Do not use the host filesystem path outside the jail.

If a path is shared-writable, owned by another untrusted account, a symlink or lacks owner/mode evidence, remote mutations stop with that path and reason. Ask the host for a dedicated FTP/SFTP account limited to your project, protected ancestors, and Unix owner/mode metadata. A private account-owned deployment directory can work without changing global daemon settings if the existing parent tree is already protected. Do not automatically chmod shared hosting directories. Another client or a backup cannot provide the missing confinement guarantee.

A jail alone is insufficient: another writer within it could redirect a destination to a different file inside the jail. Project ancestors must also exclude untrusted writers, including through ACLs. A process using the same account, a privileged administrator or the server itself remains trusted. If those are hostile, use an administrator-provided deployment service that performs root-anchored atomic operations; ordinary FTP/SFTP cannot supply that guarantee.

## Administrator setup example: OpenSSH SFTP

Example layout (names and paths are illustrative, not commands executed by the toolkit):

- /srv/devkit/account: root-owned, mode 755; every host-side ancestor must also satisfy OpenSSH requirements.
- /srv/devkit/account/project: owned by the dedicated transfer account, mode 755 or 700; no other writable ACLs.
- /srv/devkit/account/staging: owned by that account, mode 700.

Use an isolated account with no shared credentials or competing untrusted writers. Example sshd configuration:

```text
Match User devkit_upload
    ChrootDirectory /srv/devkit/account
    ForceCommand internal-sftp -d /project
    DisableForwarding yes
    PermitTTY no
```

An administrator must adapt this to the installed OpenSSH, validate using sshd -t and retain a recovery session before reloading. The toolkit never changes sshd or restarts it. [OpenSSH configuration reference](https://man.openbsd.org/sshd_config).

Toolkit profile: protocol sftp, remotePath /project, with the existing SSH host-key verification and account credentials. The login directory must identify the transfer account; root and account owners are trusted. Do not grant group/other directory writes or writable ACLs to unrelated accounts.

## Administrator setup example: FTP/FTPS

For vsftpd, use the same protected layout, a dedicated account and the daemon's account jail. Illustrative configuration:

```text
local_enable=YES
write_enable=YES
chroot_local_user=YES
local_root=/srv/devkit/account
```

Account exception lists and per-user overrides can change these settings; the administrator must verify the effective login root, including failed local_root changes, and that the account cannot reach outside the intended jail. Do not enable writable-chroot exceptions as a substitute for a protected root. Retain the host's verified TLS configuration for FTPS. [vsftpd reference](https://manpages.debian.org/testing/vsftpd/vsftpd.conf.5.en.html), [Ubuntu FTP server guide](https://ubuntu.com/server/docs/how-to/networking/ftp/).

Toolkit profile: protocol ftp, remotePath /project, ftpStagingPath /staging. FTP staging and project must share a filesystem so rename works. Enable MLST UNIX.mode/UNIX.uid facts or a consistent Unix LIST root self entry and owner metadata. The toolkit identifies unavailable facts instead of assuming them. Private staging needs MKD/RMD, 0700 mode changes and verification. Existing destination directory modes are not changed by the client.

## What is tested

Headless tests cover protected roots, login/admin owners, unknown metadata, shared-writable parents, replacement after descriptor close, blocked final rename and guarded cleanup. Real local FTP/SFTP protocol fixtures inject a changed parent after STOR or CLOSE and assert originals stay unchanged and final rename is not sent. They also verify unsafe parents are blocked before payload and protected paths succeed. These are protocol fixtures, not certification that your live server is jailed; no production credentials or server settings are used.
