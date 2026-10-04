# Integrated SFTP / FTP

Version 0.5.0 integrates the actual source from `ng-jk/vscode-sftp` 1.16.3, revision `ef4d3ca3e6fd2c0c24e05079d3dcf6093d633ce8`. Version 0.4.0 only had a reference checkout; it did not include SFTP.

Click the **Development Tools Kit** toolbox icon in the Activity Bar. **Tools** lists API Debugger, JSON Formatter, text/file comparison, Git comparison, SFTP/FTP, and CI/CD. Choose **SFTP / FTP** for the function list. **SFTP Remote Explorer** appears in the same sidebar. Explorer/editor/SCM context menus and command-palette actions are also retained.

## Setup

Open your local project and choose **SFTP / FTP → Config**. Edit `.vscode/sftp.json` with your server, username, authentication and remote path. No real server is configured automatically. Existing upstream configuration files, profiles and multiple contexts are supported. Keep passwords out of Git; omit a password for the UI prompt or use a private key/SSH agent. The terminal can read `DEVKIT_SFTP_PASSWORD` and `${env:NAME}` configuration values.

```json
{
  "name": "My server",
  "protocol": "sftp",
  "host": "server.example.com",
  "port": 22,
  "username": "deploy",
  "privateKeyPath": "~/.ssh/id_ed25519",
  "remotePath": "/srv/my-project",
  "uploadOnSave": false,
  "ignore": [".git", ".vscode", "node_modules", ".env"]
}
```

## SSH host identity

SSH transfers verify every server, including jump hosts, before authentication. Use an existing trusted `~/.ssh/known_hosts` entry (plain or hashed hostnames), set `knownHostsPath` to another OpenSSH file, or set `hostFingerprint` to a server-admin-verified `SHA256:...` fingerprint. Unknown, changed or revoked keys fail closed. Pins may be a list for an intentional key rotation. This is a deliberate security improvement over upstream automatic acceptance. An error reports the observed public fingerprint; verify it through an independent trusted channel before pinning it.

## Feature inventory

| Area | Included upstream behavior |
| --- | --- |
| Protocols | SFTP over SSH; FTP; explicit/implicit FTPS and TLS options |
| Authentication | Password prompt, private key/passphrase, agent, keyboard-interactive responses, SSH configuration, algorithms, single/multiple jump hosts |
| Configuration | `.vscode/sftp.json`, multiple workspace contexts, named profiles, default/switchable profiles, profile context overrides, external remote references |
| Transfers | File/folder/project and active-editor upload/download, force transfer, upload to all profiles, concurrency, cancellation |
| Git | Upload working-tree/staged changed files and files selected from a commit |
| Synchronization | Local-to-remote, remote-to-local, both directions, delete extraneous, skip create, ignore existing, update newer |
| Automation | Upload on save; download on open (optional confirmation); glob watcher upload/delete |
| Remote explorer | Browse/list, exclusions/order, refresh, view content, edit locally, create file/folder, delete, reveal local/remote, diff with remote |
| Transfer details | Temporary upload and rename, OpenSSH rename option, file/directory permissions, timestamps/time offsets, symlinks, open-file limits |
| Backups | Optional local Git mirror of pre-overwrite remote content, including profile-specific mirror paths |
| Feedback | Transfer status, output/debug channel and error reporting |
| Terminal | Shared engine for profile resolution, list/read/diff, upload/download/sync, create/delete/rename, Git uploads and watching; Ctrl+C cancellation; JSON and exit codes |

The complete configuration schema is `vendor/sftp/schema/config.schema.json`. UI commands below retain upstream behavior under the `devkit.sftp.*` namespace. Command names are separated from the standalone extension to avoid registration conflicts. If both extensions use the same config with automatic upload enabled, disable one to prevent duplicate transfers.

## Terminal examples

```sh
node cli.js sftp config .
node cli.js sftp profiles .
node cli.js sftp list . --profile dev
node cli.js sftp upload . src/app.js --profile dev
node cli.js sftp upload . --all-profiles
node cli.js sftp download . assets
node cli.js sftp sync-up . --profile dev
node cli.js sftp sync-both .
node cli.js sftp diff . src/app.js
node cli.js sftp upload-changed .
node cli.js sftp upload-commit . --commit HEAD
node cli.js sftp rename . old.txt --to new.txt
node cli.js sftp delete . old.txt --yes
node cli.js sftp watch .
node cli.js sftp --help
```

Paths are relative to the selected profile's local context. Use `--context NAME` for a multi-context configuration, `--config FILE` for a different config, and `--force` to bypass ignore rules for transfers. Destructive terminal sync/delete settings require `--yes`. Terminal SSH uses the system SSH client; jump-host terminal sessions can use an SSH config alias. SFTP jump-host file transfers use the upstream SSH transport. UI actions tied to an active editor, clipboard, native diff or reveal have explicit-path/JSON equivalents in the CLI.

## Architecture and verification

`src/data/sftp` owns SSH/FTP/local files, mirror I/O, and injected host callbacks. `src/logic/sftp` owns configuration/profile resolution, transfer scheduling and sync decisions. `src/interface/sftp` contains the imported VS Code adapters; `src/interface/sftp-cli.js` is the terminal adapter. Both use the same transfer and filesystem implementation. `scripts/build-sftp.js` bundles UI and headless entry points, and rejects interface imports in the headless bundle. Architecture checks include nested TypeScript source.

Automated tests cover local file workflows, ignore rules, profile contexts, temporary uploads, sync deletion, permission failures, failed transfers, path rejection, terminal exit codes, real local SSH/SFTP and passive FTP exchanges, and command/sidebar registration through a host adapter. These are not claims of user acceptance or tests against your production server. FTPS, agent authentication, jump hosts, all server variants and the native VS Code host still require environment-specific acceptance.

The fork also verifies SSH host keys, corrects reverse filesystem selection in bidirectional sync and SSH terminal argument ordering, blocks normalized root deletion aliases, corrects upstream SSH event registration, waits for deletion failures, propagates scheduler errors, avoids treating permission errors as empty sync directories, masks nested configuration credentials in logs, and isolates connection-cache identities. It retains the original MIT notices.

## Complete upstream command list

| Function | Toolkit command |
| --- | --- |
| Config | `devkit.sftp.config` |
| Set Profile | `devkit.sftp.setProfile` |
| Open SSH in Terminal | `devkit.sftp.openConnectInTerminal` |
| Cancel All Transfers | `devkit.sftp.cancelAllTransfer` |
| Upload File | `devkit.sftp.upload.file` |
| Upload Changed Files | `devkit.sftp.upload.changedFiles` |
| Upload File Changed (Pick Commit) | `devkit.sftp.upload.fileChanged` |
| Upload Active File | `devkit.sftp.upload.activeFile` |
| Upload Folder | `devkit.sftp.upload.folder` |
| Upload Active Folder | `devkit.sftp.upload.activeFolder` |
| Upload Project | `devkit.sftp.upload.project` |
| Force Upload | `devkit.sftp.forceUpload` |
| Upload File To All Profiles | `devkit.sftp.upload.file.to.allProfiles` |
| Upload Active File To All Profiles | `devkit.sftp.upload.activeFile.to.allProfiles` |
| Upload Folder To All Profiles | `devkit.sftp.upload.folder.to.allProfiles` |
| Upload Active Folder To All Profiles | `devkit.sftp.upload.activeFolder.to.allProfiles` |
| Upload Project To All Profiles | `devkit.sftp.upload.project.to.allProfiles` |
| Force Upload To All Profiles | `devkit.sftp.forceUpload.to.allProfiles` |
| Download File | `devkit.sftp.download.file` |
| Download Active File | `devkit.sftp.download.activeFile` |
| Download Folder | `devkit.sftp.download.folder` |
| Download Active Folder | `devkit.sftp.download.activeFolder` |
| Download Project | `devkit.sftp.download.project` |
| Force Download | `devkit.sftp.forceDownload` |
| Sync Local -> Remote | `devkit.sftp.sync.localToRemote` |
| Sync Remote -> Local | `devkit.sftp.sync.remoteToLocal` |
| Sync Both Directions | `devkit.sftp.sync.bothDirections` |
| Diff with Remote | `devkit.sftp.diff` |
| Diff Active File with Remote | `devkit.sftp.diff.activeFile` |
| List | `devkit.sftp.list` |
| List Active Folder | `devkit.sftp.listActiveFolder` |
| List All | `devkit.sftp.listAll` |
| Delete | `devkit.sftp.delete.remote` |
| Create Folder | `devkit.sftp.create.folder` |
| Create File | `devkit.sftp.create.file` |
| Reveal in Explorer | `devkit.sftp.revealInExplorer` |
| Reveal in Remote Explorer | `devkit.sftp.revealInRemoteExplorer` |
| Edit in Local | `devkit.sftp.remoteExplorer.editInLocal` |
| View Content | `devkit.sftp.viewContent` |
| Refresh | `devkit.sftp.remoteExplorer.refresh` |
| Refresh Active Remote File | `devkit.sftp.remoteExplorer.refreshActiveFile` |

Remote directory entries are validated before transfer: traversal, embedded separators, Windows device names and other unsafe cross-platform names are rejected. Sync deletion walks directories and retains ignored descendants. FTP creation recognizes missing files consistently. Watch settings come from the selected profile; `watcher.files: false` disables watcher actions while separately configured upload-on-save remains available.

Downloads reject symlink targets outside the configured local context and refuse writes through existing destination symlinks. This deliberately restricts unsafe link behavior inherited from upstream. Switching profiles reloads watchers even when the local context stays the same and drops pending watcher events for that context. Git changed-file uploads await completion and map rename endpoints to the remote root.

Commit and selected-file uploads select paths and upload their current local contents, including root commits; deletions are excluded from those selections. SCM Upload Changed Files and CLI upload-changed share the transfer planner. The CLI represents renames as an upload of the new path plus deletion of the old path, and requires --yes when deletions are present. Same-context SCM renames happen before uploading edited destination contents; moves across contexts never rename an unrelated remote path. All-profile transfers resolve the same relative selection independently within each profile context. Sync preserves symbolic links instead of reading through them.

Transfers now always write to a unique staging file before replacement, including when the legacy `useTempFile` option is false. Servers need create/rename permission in the destination folder. OpenSSH atomic rename remains optional; otherwise the old destination is retained in a backup during replacement and restored if the final rename fails. A failed restore reports the retained backup path. Changed symlinks are replaced rather than silently skipped; FTP symlink creation fails explicitly because FTP provides no portable symlink command. These are deliberate safety corrections to upstream behavior.

Internal `.devkit-UUID` staging and recovery files are excluded from normal transfers and watcher actions to prevent automatic re-upload of temporary content. Retained recovery files can be restored manually after an interrupted replacement.

UI and CLI configuration templates share exclusions for `.git`, `.vscode`, `.env`, `.env.*` and `node_modules`; review custom ignore lists before a project upload. Download-generated filesystem events are suppressed while transfers run and afterward when the file still matches the completed write. Actual later user edits/deletions are not suppressed. Staged replacement preserves existing regular-file permissions; a new file uses source permissions when available.

SSH terminal sessions enforce StrictHostKeyChecking and support a configured knownHostsPath for a single server. They explicitly reject hostFingerprint pins and configured hop chains because the system SSH invocation cannot enforce those per-hop pin policies; use independently trusted OpenSSH aliases for terminal sessions. SFTP transfers retain pin and hop support. Git change classification/sequencing and mirror backup concurrency/deduplication/commit policy live in logic; repository/filesystem access lives in data adapters.

Recursive transfers use each child file’s permissions, rather than its parent directory’s mode. Sync compares symlink targets even when sizes/timestamps match. Configuration reads/creation are shared data adapters; environment substitution and defaults are shared logic available to both the terminal and VS Code.

FTP rejects CR/LF/NUL command delimiters and validates recursive deletion listings before issuing deletion commands. Upload file/directory permission overrides are ignored for local downloads in both interfaces, including reverse tasks during bidirectional sync. Replacing a symlink with a regular file uses file permissions, not the link’s mode.
