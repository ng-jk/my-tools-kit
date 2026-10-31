# Remote permission and isolation policy

Version 0.7.16 uses a protected account namespace for remote mutations. Earlier unpublished candidates allowed shared destination ancestors; review identified a pathname replacement race, so those candidates were never uploaded. The user subsequently requested server isolation support and replacement tests.

A jail limits account reach, but does not protect a selected path from another writer inside that jail. Use a dedicated transfer account, administrator-owned non-writable jail root and account-owned protected project/staging directories. Ancestor ownership/mode checks fail closed; existing remote directories are never automatically chmodded. Ownership, modes, symlink/type errors and missing facts identify the actual failing path.

The server administrator remains responsible for ACLs, mounts and privileged writers. The client cannot prove jail configuration through ordinary FTP/SFTP, and no boolean setting bypasses that limitation. A passed metadata diagnostic is not an attestation of server configuration.

Without server administration access, run the read-only isolation diagnostic. Existing protected account trees work without server edits. Otherwise ask the host for a dedicated jailed transfer account and protected directories, or deploy to a protected location. Read-only browsing/download remains available. Backups or another client do not eliminate the replacement race.

FTP plaintext staging stays in a separate private directory until final mode verification. Parent checks refresh before final replacement and before cleanup; a detected replacement prevents unsafe rename/unlink. These checks supplement protected server permissions, not an atomic rename-at guarantee. Ordinary protocols cannot guarantee safety against a malicious server administrator or another process using the same authenticated account.

See [server-isolation.md](server-isolation.md) for setup examples and commands.
