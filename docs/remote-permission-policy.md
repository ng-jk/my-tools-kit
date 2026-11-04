# FTP/SFTP transfer policy and security scope

## Owner decision, 2026-11-04

After the folder-permission and isolation limitations were explained, the owner explicitly requested: "fix it, i dont need no such restriction" for the /hr-leave mode-775 rejection. After a further plain-language explanation that another account could replace shared directories using any tool, the owner confirmed: "so just remove it and publish". This explicitly authorizes the trusted-server review scope and the known remote namespace risk. Version 0.7.17 implements that requirement: no automatic remote ancestor mode/owner/jail gate, no exception toggle, no forced chmod of existing server directories and no demand to contact an administrator before upload.

## Product contract

This is a conventional authenticated FTP/SFTP client. It trusts the configured server, the account login namespace and other parties able to mutate that namespace. Group/other-write bits and missing Unix ownership facts are not treated as upload denials. Actual protocol permission, authentication, missing-path and backup failures still fail with the actual affected operation/path. Relative remote roots retain normal login-relative behavior.

The server is responsible for access control and any OS jail/ACL policy. The product does not promise confinement against a malicious co-writer, account peer, server administrator or server itself. Such a writer can replace a directory between a path check and OPEN/rename. This is a known limitation of this owner-selected trust model; no claim is made that rechecking paths, a random name, private staging or backups eliminates it. Use a different account/server if that trust assumption does not hold.

## Retained behavior

- Reject lexical escapes outside the configured local/remote root and observed symlink/non-directory parents.
- Recheck directory types before replacement and cleanup; stop on detected replacements. These are best-effort checks, not atomic root-anchored operations.
- Back up existing originals before replacement; preserve abort and recovery behavior.
- FTP uses STOR inside a newly created 0700 staging directory; verify that directory and final payload mode before rename. The existing staging-root ancestors are not subject to owner/mode gates.
- Keep TLS verification, SSH host-key checks, credential isolation, private-key handling, credential scanning and mandatory AI reviews. All approval predicates are unchanged. The pipeline explicitly supplies the operator-selected trusted-server FTP/SFTP review scope through the bounded remoteNamespaceTrust field; see pipeline-usage.md. A rejected, malformed or high/critical review still prevents publication.
- Keep optional isolation diagnostics as read-only advisory information. Their result is explicitly not enforced by upload/create/delete/rename.

The tests demonstrate uploads through 775/777 parents without changing their modes, operation without root ownership facts, shared logic for UI/terminal, private FTP payload staging and detected folder replacement before later mutations. They do not certify production server isolation or exercise real production credentials.
