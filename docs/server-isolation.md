# Optional server-isolation advisory

Version 0.7.17 does not require isolation checks for transfers. Existing 775/777 modes, other owners and missing Unix owner facts do not block uploads, creation, rename or delete. Transfers trust the authenticated server namespace. See [the transfer policy](remote-permission-policy.md) for its scope.

**SFTP: Check Server Isolation** opens an optional, read-only advisory report. Duplicate connection names show host/port and workspace/context; progress includes connection setup. A failing advisory does not prevent uploads. It does not establish jail, ACL or mount configuration, and changes no files or server settings.

Terminal equivalent:

```sh
node cli.js sftp isolation . --context production --profile live
```

Omit unused context/profile options. Exit 0 means the metadata advisory passed; exit 1 means shared/unverifiable metadata or another inspection failure. This exit code applies only to this explicitly invoked advisory command. Uploads do not call it or enforce its result. The report identifies server, context/profile, remote root, its advisory result and enforced=false without credentials.

## When you cannot edit the server

No administrator setup is required by the client. Upload normally with your existing context/profile. Existing directory permissions are unchanged; dirPerm controls newly created directories. The server can still reject writes or report missing/unreadable files, which remain actual operation errors. FTP's temporary-upload directory must support creation of a new 0700 subdirectory and final mode verification. An absolute ftpStagingPath can select another existing temporary-upload root on the same filesystem.

## Trust and optional hardening

The client trusts parties able to mutate its remote namespace. A malicious co-writer can redirect path-based operations between checks; a jail only limits account reach and does not stop interference inside it. Private staging, backups and repeated checks do not eliminate this protocol limitation. The following examples are optional hardening for administrators, not product prerequisites. They are not executed by the toolkit.

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

Toolkit profile: protocol ftp, remotePath /project, ftpStagingPath /staging. FTP staging and project must share a filesystem so rename works. The optional advisory can use MLST UNIX.mode/UNIX.uid facts or a Unix LIST root self entry. Transfers do not require those root ownership facts. Private staging needs MKD/RMD, 0700 mode changes and verification. Existing destination directory modes are not changed by the client.

## What is tested

Headless tests cover protected roots, login/admin owners, unknown metadata, shared-writable parents, replacement after descriptor close, blocked final rename and guarded cleanup. Real local FTP/SFTP protocol fixtures inject a changed parent after STOR or CLOSE and assert originals stay unchanged and final rename is not sent. Uploads through shared modes and without root ownership metadata are also tested. These are protocol fixtures, not certification that your live server is jailed; no production credentials or server settings are used.
