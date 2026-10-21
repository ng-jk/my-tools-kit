# Development Tools Kit — user guide

### Independent FTP/SFTP profiles

Each entry in `profiles` can set its own `protocol`, `port`, `context` (local folder relative to the workspace), `remotePath`, `host`, `username` and `password`. Top-level options are shared defaults; profile values override them. A profile that switches protocol without specifying a port uses the new protocol's default (FTP 21, SFTP 22). Use **SFTP: Set Profile** to switch. Set `"defaultProfile": "api_live"` to choose the initial profile explicitly. When no top-level host or external `remote` reference exists and no default is specified, the first profile is selected automatically. Base connections that resolve their username from SSH configuration keep their base selection. An omitted `context` uses the workspace root or the shared context. Keep real credential-bearing configuration files out of Git; `${env:VARIABLE_NAME}` can supply credential fields.

SFTP troubleshooting: errors identify a missing configuration file, invalid JSON or fields, a file outside the active local context, DNS/port/network failure, or rejected authentication. For rejected authentication check the selected context's username, password or SSH key; servers often do not reveal which credential is wrong. Never include passwords in an error report. Diff reports whether the missing file is local or on the server.

Uploads preserve destination permission bits by default and ensure owner-write access, including when the source or previous destination was read-only. Group/other access is unchanged, and special permission bits are not copied. Set `filePerm` explicitly (for example `640` or `644`) to override this policy; an explicit read-only mode such as `444` intentionally prevents editing. Server ownership, ACLs and directory access remain controlled by the server account.

Open the **Development Tools Kit** toolbox icon in VS Code’s Activity Bar, then choose a tool. This guide shows how to configure and use each function.

[Release notes](CHANGELOG.md) · [Report a problem](https://github.com/ng-jk/my-tools-kit/issues) · [Source code](https://github.com/ng-jk/my-tools-kit)

## Install and open

1. In VS Code, open **Extensions** and search for **Development Tools Kit** by **NGJUNKAI**. Install the available Marketplace version.
2. To test a newer local build, use **Extensions → … → Install from VSIX…**, choose `development-tools-kit.vsix`, then reload VS Code.
3. Click the toolbox icon in the Activity Bar. The Tools list contains **API Debugger**, **JSON Formatter**, **Compare Text / Files**, **Compare Git Revisions**, **SFTP / FTP**, **Database**, and **CI/CD Pipeline**.
4. Alternatively, press **Ctrl+Shift+P** (macOS: **Cmd+Shift+P**) and search for **Development Tools Kit** or **SFTP**.

Requires VS Code 1.96+. FTP/SFTP dependencies are bundled. Git comparisons require Git. CI/CD requires Python 3.11+ and the test/build CLIs configured for your project. Trust your workspace to enable the extension. If a command described below is missing, check which extension version is installed.

## Separate FTP/SFTP contexts

Remote entries such as `nul` do not block unrelated uploads. Windows reserves certain local filenames; rename those remote entries before downloading them to Windows. Upload confirmations use one native Cancel button.

**Cancel All Transfers** also cancels operations waiting for a target, confirmation or metadata. Accepting an old confirmation after cancellation does not resume the transfer; start a new command when ready.

For FTPS, set `protocol` to `"ftp"` and `secure` to `true` (explicit TLS) or `"implicit"` (TLS from connection start), with your server's port. Both protect file data as well as authentication. Certificate verification is enabled by default; use a trusted CA through `secureOptions.ca` for private certificates. Invalid certificates stop the transfer before data commands. Plain FTP (`secure: false`) provides no transport encryption.

A context is one complete connection configuration. Give development, staging, production, or different customers their own contexts. Each has its own IP/hostname, protocol, port, username, password/key, local folder, remote path, host verification, ignore rules, watcher and sync settings. Contexts do not inherit settings or credentials from one another.

1. Open your project folder.
2. Choose **SFTP / FTP → Config**. This opens `.vscode/sftp.json`; a new file starts with a `development` context.
3. Replace the example values with your own. Add another entry under `contexts` for each independent connection:

```json
{
  "activeContext": "development",
  "contexts": {
    "development": {
      "context": ".",
      "protocol": "sftp",
      "host": "192.0.2.10",
      "port": 22,
      "username": "dev-user",
      "privateKeyPath": "~/.ssh/dev_key",
      "knownHostsPath": "~/.ssh/known_hosts",
      "remotePath": "/srv/development",
      "uploadOnSave": false,
      "ignore": [".git", ".vscode", ".env", ".env.*", "node_modules"]
    },
    "staging": {
      "context": ".",
      "protocol": "ftp",
      "host": "192.0.2.20",
      "port": 21,
      "username": "staging-user",
      "password": "${env:STAGING_FTP_PASSWORD}",
      "secure": true,
      "remotePath": "/public_html/staging",
      "uploadOnSave": false,
      "ignore": [".git", ".vscode", ".env", ".env.*", "node_modules"]
    }
  }
}
```

4. Save the file. Choose **SFTP / FTP → Select Context** (or **SFTP: Select Context** in the Command Palette), then pick a context. Its name appears in **SFTP Remote Explorer**.
5. Expand that server root to list files. Switching context cancels/disposes the previous service and its watchers, then loads the selected configuration. Only the active context receives automatic file operations.

`context` inside each entry is the **local folder**, relative to your workspace (for example `frontend`); `remotePath` is the destination folder on that server. Both contexts may use the same local folder. The key under `contexts`, such as `staging`, is the selection name. To add, rename, edit or remove a context, edit `.vscode/sftp.json` and save; keep `activeContext` set to an existing key.

For password authentication, omit `password` to use VS Code’s masked prompt, or give each context a separate `${env:VARIABLE}` reference. Start VS Code from an environment containing those variables; restart it after changing the environment. Inactive contexts’ variables are not resolved. Named contexts in the CLI require their own password reference or key/agent; they do not fall back to a shared `DEVKIT_SFTP_PASSWORD`.

SFTP verifies host keys: use a trusted `knownHostsPath` or independently verified `hostFingerprint`. Keep `.vscode/sftp.json` out of Git if it contains credentials. Config can also use separate SSH keys, passphrases, agent settings and jump-host configuration per context. Existing single-object and array configurations still work with distinct resolved local roots; the named-context format above is recommended when connections share a local folder. Legacy `profiles` inherit their parent settings; use independent contexts when you need complete separation.

### Transfer, edit and compare remote files

| Task | How to use it |
| --- | --- |
| List remote files | Expand the selected context in **SFTP Remote Explorer**, or choose **List** in the SFTP menu. |
| Upload | Select files/folders in VS Code Explorer, right-click and choose the SFTP upload action. Active-file and project upload actions are also in the SFTP menu. |
| Download | Select a file/folder in Remote Explorer and choose **Download**. The local destination is inside that context’s local folder. |
| Edit a remote file | Use **Edit in Local** in Remote Explorer, edit the downloaded file, then upload it. Enable `uploadOnSave` only if you want saving to upload automatically. |
| View without editing | Use **View Content** from the remote file menu. |
| Compare with remote | Choose the SFTP **Diff** action for a local file to open VS Code’s diff editor. |
| Create or delete | Use **Create File**, **Create Folder**, or **Delete Remote** from the SFTP menu or remote context menu. Select the destination when prompted. |
| Synchronize | Choose **Sync Local → Remote**, **Sync Remote → Local**, or **Sync Both Directions**. Set `syncOption` within the selected context. `delete: true` can remove destination-only files. |
| Upload Git changes | Use **Upload Changed Files** for staged/working-tree changes, or **Upload File Changed** to select filenames changed by a commit. This uploads their **current local contents**, not historical commit contents; the picker and SFTP Output state that distinction. Upload-only batches show resolved local sources, profiles and server destinations in SFTP Output, then start automatically after backup; Cancel All remains available; batches containing remote deletions or renames still show their scope for confirmation. |
| Watch local changes | Set `watcher.files`, `watcher.autoUpload`, and optionally `watcher.autoDelete` inside the context. Saving its configuration recreates the watcher. |
| Connect with SSH | Choose the SSH terminal action for the selected SFTP server; requires your system SSH client. |
| Stop or troubleshoot | Choose **Cancel All Transfers**, **Show Output**, or Remote Explorer’s refresh button. |

If Configure SFTP cannot open the editor, use the error notification’s Detail action, resolve the editor/workspace issue, and run Configure SFTP again; existing configuration is preserved. Download File accepts only regular files; use Download Folder for directories. Automatic upload/download/watcher failures identify both paths and offer Show details or Retry; retries stay tied to the original context. Cancelling a retry leaves the failure unresolved and reports cancellation. Successful recovery clears the error indicator; opening Details alone does not mark the failure resolved. Uploads automatically back up existing remote files before replacement and no longer display an overwrite popup. Backups live outside your project in `~/.devkit-backups/sftp/<connection-id>` (Windows: `%USERPROFILE%\.devkit-backups\sftp\<connection-id>`); **SFTP: Show Output** displays the exact folder. Each workspace/context/profile/server/account has a separate backup history. Open that folder in Git to inspect older revisions or use `git show <commit>:<relative-file>` to recover content into a local file, then upload it normally. Symlink originals are stored in Git as link-target text (mode `120000`), without creating or following a local symlink; use Git history to inspect/recover the link target. New SFTP destinations have no prior content to back up. FTP LIST can omit existing files: if a destination is unlisted, backup first requests hidden entries to establish its type without reading a symlink referent. If its type/absence cannot be established or its backup cannot be read, upload stops; use SFTP to create new destinations safely. Backup failures stop the upload and identify the failing file. An enabled `mirror.path` overrides the default location and must stay outside the workspace. Backups may contain private server content: keep them local and do not publish their Git repository. FTP uploads use standard `STOR`, so servers that reject append/restart commands are supported. The server must allow creating/removing temporary directories and setting their permissions to `0700`. Payloads stay inside a verified private directory until final file permissions are restored and verified, then staged replacement proceeds. FTP planning reuses directory metadata, then discards it before sending payloads; server latency and the required backup download still affect elapsed time. **Force Upload/Download** bypass ignore filtering, including credential-file exclusions; Force Upload retains its separate exclusion warning. **Upload to All Profiles** shows the resolved local source and server destination for every profile in SFTP Output before starting, without an overwrite popup. Each profile uses its own local context, so source content can differ. It addresses legacy profiles inside the active context; it never means all independent contexts. Use a disposable folder before enabling automatic deletion. Transfers, creation, delete and rename reject existing symlink parent folders and require existing remote roots to be real directories; use the canonical server path. A symlink itself can still be deleted or renamed. FTP file creation and destructive FTP sync-down are blocked where FTP cannot provide the required safety guarantees; use SFTP for those operations. [Full command inventory and protocol limits](https://github.com/ng-jk/my-tools-kit/blob/developement/docs/sftp.md).

## API Debugger

### Send your first request

1. Choose **API Debugger** from the toolbox.
2. Click **＋** to add a request; give it a name, select **GET**, and enter your endpoint URL.
3. Open **Query** or **Headers**. Enter names and values in rows; check/uncheck rows to include/exclude them. Duplicate query names are supported. **Raw** headers accepts `Name: value` lines or JSON; turn it off to return to rows.
4. Click **Send**. Read **Status / Size / Time**, then switch between **Response**, **Headers**, **Cookies**, **Results**, **Docs** and **Logs**. Use **Raw response**, **Wrap**, **Copy response**, or **Save response** to inspect/export it. Use **Cancel** to stop a pending request.
5. Click **Save** under Collection to keep your requests. **Save response** writes the response to a file.

### Bodies and authentication

For POST/PUT/PATCH, open **Body** and choose **JSON**, **XML**, **Text**, **Form (multipart)**, **Form-encode**, **GraphQL**, or **Binary**. JSON Format preserves large number and string values. Form rows have enable switches; multipart rows can be text or project-relative file paths. GraphQL provides query, variables JSON and an optional operation name. Binary takes a project-relative file path. **None** sends no body. Switching body types retains each mode's unsent draft.

Open **Auth**, select a method, and fill the labeled fields. Advanced JSON is optional:

| Method | Example fields |
| --- | --- |
| Bearer | `{"token":"{{secret.TOKEN}}"}` |
| Basic | `{"username":"user","password":"{{secret.PASSWORD}}"}` |
| API key | `{"name":"X-API-Key","value":"{{secret.KEY}}","in":"header"}` |
| OAuth 2 client credentials | `{"tokenUrl":"https://example.com/token","clientId":"client","clientSecret":"{{secret.CLIENT_SECRET}}","scope":"read"}` |
| NTLMv2 | Username, password, domain and workstation. Negotiation uses a safe HEAD probe, which must receive a challenge on the same connection. Servers must provide extended security and target information; NTLMv1 fallback is blocked. Endpoints that do not challenge HEAD fail without sending a mutation payload. |
| AWS Signature V4 | Explicit accessKeyId, secretAccessKey, region and service; optional sessionToken. No ambient AWS credentials are selected. |

OAuth 2 also accepts `grantType` values `password`, `authorization_code`, and `refresh_token` with their corresponding fields. For authorization code, obtain the code through your provider's authorization page and supply code, redirectUri and optional PKCE codeVerifier. This editor does not automatically open a browser callback listener.

Click **Store secret securely** to save a named secret in VS Code SecretStorage. Use `{{secret.NAME}}` in the request. For reusable values, enter an environment JSON object such as `{"baseUrl":"https://example.com"}` and use `{{baseUrl}}` in URLs. **Load env / Save env** manage environment files; keep credential files local and out of Git.

### Tests, collections and imports

- Open **Tests → Tests** and add status, time, header, body or JSON-path assertions. Remove individual rules as needed and inspect **Results** after Send. **Tests → Scripting** edits the after-response script.
- Add multiple requests with **＋**, save the collection, and choose **Run collection** to run it sequentially. Use **Duplicate**, **Delete request**, and the request search to organize it.
- Use **Import / Open** for native collections, supported Postman/Thunder Client data, or OpenAPI endpoints. Inspect import warnings; scripts/assertions may not migrate completely. **Export Postman** and **Copy cURL template** are partial exports.
- In **Advanced**, set timeout, redirects, response extraction and TLS files as needed. Extraction entries such as `[{"variable":"id","path":"data.id"}]` make response values available to later requests.
- **Pre Run → Pre Requests → Add request** selects a collection and saved request to run first. Add multiple entries to set order. Extracted variables, scripts and cookies carry forward; missing references, failed pre-requests and cycles stop the main request. Import/Open keeps collections in the session library; switch with **Active collection**. **Save collection library for CLI** writes the library for `node cli.js send request.json --collections api-library.json` (also accepted by `run`). Save the main request/collection separately.

Each collection keeps its own local variable defaults. Shared environment values override those defaults; only extracted values and explicit script assignments carry between pre-request collections. This prevents one collection's base URL or credentials from silently retargeting another collection's request.
- **Pre Run → Scripting** edits the before-request script. Enable **Advanced → Run trusted scripts** only for trusted code: scripts have local process privileges and a two-second execution limit. The API is `env.get/set`, `request`, `response`, `test(name, fn)`, `assert(condition)` and `console.log`. Pre-scripts can change the outgoing request. Importing a collection disables script execution until enabled again.
- **Docs → Edit** writes plain-text request documentation; **Save docs** keeps it in the request draft and collection Save writes it to disk. **Undo delete** restores the last removed request.

Changing editor focus or returning to the API command reuses the same panel. Unsent values, including incomplete JSON and raw headers, survive hiding and webview reload while the extension session remains alive. Drafts, auth-mode histories, response cookies and response history stay in memory; Save is required to survive panel closure or a VS Code restart. Saved JSON may contain credentials: export warns before writing, and secret placeholders are recommended.

The screenshot workflows above are implemented independently. Digest auth, an automatic OAuth browser callback, proxies, WebSockets/gRPC and complete Thunder Client/Postman script migration are outside these workflows.

## JSON Formatter

1. Choose **JSON Formatter** from the toolbox.
2. Paste JSON or load a file. Choose two spaces, four spaces, or tabs.
3. Click **Format** for readable JSON, **Minify** for compact JSON, or **Validate** to check syntax.
4. Copy/save the result, open it in an editor, or send it to either comparison side. **Undo tool edit** restores the preceding tool result.

Invalid input is retained with an error. Formatting preserves large numbers, key order, duplicate keys and number spelling; it changes whitespace only. It accepts strict JSON, not comments or trailing commas. To format an existing editor, run **Format JSON Document or Selection** from the Command Palette. It formats the selection, or the entire document if nothing is selected.


## Compare two long pastes or two files

1. Choose **Compare Text / Files**.
2. Paste text into **Original** and **Modified**, or use each side’s **Paste / Load file** buttons. Use **Swap** if the sides are reversed.
3. Optionally normalize JSON/line endings or ignore case/outer whitespace.
4. Click **Compare texts** or press **Ctrl/Cmd+Enter**. VS Code opens a native diff editor with immutable snapshots.

**Clear both** retains a recovery snapshot. **Undo clear** restores both texts and file labels. If you edited either input after clearing, **Undo restore** lets you switch back to those later edits. Recovery remains available while this panel stays open.
5. Use the diff editor’s next/previous change arrows, search and inline/side-by-side controls. Return to the tools tab to change inputs and compare again.

For files, run **Compare Two Files** and pick both files, or select two files in Explorer and use its comparison command. To compare a selected editor passage with your clipboard, right-click and choose **Compare Editor or Selection with Clipboard**. Source files stay unchanged. Pasted text is session-local and is not restored after restarting VS Code.

Binary/non-UTF files display size, SHA-256 identity and a hex excerpt; this does not visually compare PDFs/images/Office files. Text comparison supports up to 20 MiB per side. Check the native diff editor’s **Ignore Trim Whitespace** setting when whitespace matters.



## Compare any two Git revisions

1. Choose **Compare Git Revisions**, then **Select repository…**.
2. Enter a branch, tag, commit hash, or expression such as `HEAD~1` on each side. For example, original `HEAD~1`, modified `HEAD` compares the last commit.
3. Use **WORKTREE** on the right for local tracked/untracked changes or **INDEX** for staged changes.
4. Click **Show changed files**, filter the list, then click a file to see its diff. Renames use the old and new paths; additions/deletions have an empty side.
5. Expand **Compare specific files** to compare different file paths from the two revisions.

No checkout is needed. The tool does not fetch, stage, commit or modify your files. If Git reports dubious ownership, verify that you trust the repository and configure Git’s `safe.directory` for that exact path yourself.


## CI/CD Pipeline — menu actions

Choose **CI/CD Pipeline** in the toolbox (or **Development Tools Kit: Configure CI/CD**), select your workspace when prompted, then choose an action below. Each action opens a VS Code task: read its terminal output and exit status to see the result.

Your project must have a `.devkit-pipeline.json` containing its own test/build commands. If it is missing or invalid, the menu offers Create/Repair pipeline configuration, Pipeline setup guide, and Status. Create opens an unsaved configuration file; follow the guide, save your project-specific commands, then reopen the menu. Repair opens the existing file without replacing it. Set **Development Tools Kit: Python Path** in Settings if Python 3.11+ is not discovered. This tool operates on the selected project; it does not automatically configure or deploy websites.

| Menu action | How to use it and what happens |
| --- | --- |
| Status | Choose this first to inspect branch commits, the configured AI reviewer and saved evidence location. It does not publish anything. |
| Verify Marketplace access | Choose this for a project configured to publish a VS Code extension. It checks the locally signed-in identity’s Marketplace access without uploading. |
| Initialize branches | Choose this when the configured repository needs its workflow branches. Missing development/test/deployment branches are created from main; existing branches are retained. |
| Check current changes | Choose this while developing, including with uncommitted edits. It runs architecture, unit, functional, integration and build checks. Read failures in the task terminal; this does not create release approval. |
| Test committed development | Commit your changes first, then choose this. It sets the test candidate and runs isolated checks plus AI review, retaining artifacts when successful. A test-branch update alone does not mean tests passed. |
| Test and push test branch | Use when you also want the candidate test branch pushed to the configured Git remote. Otherwise it performs the same checks as Test committed development. |
| Review UI/UX and release | Choose this to run committed-candidate tests, technical AI review and a separate UI/UX code review, then automatically publish and promote the same candidate if all gates pass. No manual UI acceptance is needed in this project. |
| Publish | Use for an approved candidate, or to retry a failed publication. It checks deployment gates, publishes the approved artifact if configured, verifies it, and only then advances main. Failures leave main unchanged. |

Keep the task running until it reports completion. AI review needs an authenticated supported AI CLI. This project uses `interfaceReview: "ai-ux"`: a separate code review checks task flow, labels and feedback, error recovery, destructive actions, keyboard access, accessibility and layout. Every criterion needs source evidence; failed criteria or unavailable review block release. This is source review, not rendered visual testing or proof of usability with real users. Publisher credentials, build commands, packaging and release recovery are covered in the separate [developer guide](https://github.com/ng-jk/my-tools-kit/blob/developement/docs/development.md).

## Complete VS Code command reference

Press **Ctrl+Shift+P** (**Cmd+Shift+P** on macOS) to find available palette commands. For SFTP, the toolbox’s **SFTP / FTP** menu includes the functions below, including commands hidden from the palette. File-specific actions also appear in Explorer/Remote Explorer context menus. The command ID is provided for custom keybindings; it is not a terminal command.

Select a context before transferring. “Active file” means the file open in your focused editor; “active folder” is its parent folder; “project” means the configured local context, which may be smaller than the workspace. Every manual sync asks you to confirm the source, destination and possible overwrites. Dirty editors in scope are saved before planning; those programmatic saves do not trigger independent upload-on-save or watcher transfers, so the chosen sync options remain authoritative. Sync with `syncOption.delete: true` can also delete destination-only files. **To All Profiles** operates on legacy profiles within the active context, not all named contexts.

### Workspace tools

| Command | How to use it and result |
| --- | --- |
| **Development Tools Kit: Open API Debugger**<br>`devkit.open` | Choose from the toolbox or Command Palette. Enter a method and URL, configure the tabs, then click Send; inspect the response below. |
| **Development Tools Kit: Configure CI/CD**<br>`devkit.pipeline` | Open a project, run this command, select the workspace if prompted, and choose a pipeline action from the table above. |
| **Development Tools Kit: Store API Secret**<br>`devkit.secret` | Run this command or click Store secret securely in API Debugger. Enter a secret name and value; reference it as {{secret.NAME}} in requests. |
| **Development Tools Kit: Compare Text / Open Text Tools**<br>`devkit.textTools` | Open this command, paste or load Original and Modified text, then choose Compare texts to open the native diff editor. |
| **Development Tools Kit: Open JSON Formatter**<br>`devkit.jsonFormatter` | Open this command, paste JSON, choose indentation and click Format, Minify or Validate. Copy or save the result. |
| **Development Tools Kit: Format JSON Document or Selection**<br>`devkit.formatJson` | Focus a JSON editor and optionally select a JSON value. Run this to format that selection, or the whole document if nothing is selected; Undo restores the edit. |
| **Development Tools Kit: Compare Two Files**<br>`devkit.compareFiles` | Select two files in Explorer and invoke the command, or run it and choose the original and modified files. It opens a text diff or binary comparison summary. |
| **Development Tools Kit: Compare Editor or Selection with Clipboard**<br>`devkit.compareClipboard` | Copy the comparison text, focus an editor and optionally select text, then run this command. It compares the selection (or entire editor) against the clipboard. |
| **Development Tools Kit: Compare Git Revisions**<br>`devkit.compareGit` | Choose a repository, set both revisions, click Show changed files and select a file. Use INDEX or WORKTREE on the right for staged or local changes. |

### FTP/SFTP commands

| Command | How to use it and result |
| --- | --- |
| **Config**<br>`devkit.sftp.config` | Open a project and choose this command. Select a workspace folder if prompted; edit and save .vscode/sftp.json with your server settings. |
| **Set Profile**<br>`devkit.sftp.setProfile` | Choose the configuration first when several are available, then choose its legacy profile. UNSET uses that configuration’s base settings. Only the selected configuration and its watcher are changed. |
| **Open SSH in Terminal**<br>`devkit.sftp.openConnectInTerminal` | Choose a configured SFTP server to open it using your system SSH client. Use a trusted SSH config alias for terminal jump hosts; FTP has no SSH terminal. |
| **Cancel All Transfers**<br>`devkit.sftp.cancelAllTransfer` | Choose while transfers are running to cancel pending and active operations. Inspect output for any partially completed work. |
| **Upload File**<br>`devkit.sftp.upload.file` | Select a local file in Explorer, or focus its editor, then choose this. Without either selection, pick the file when prompted. Only regular files are accepted. Review the destination and choose Upload. Ignore rules remain active; excluded files show a skipped message. |
| **Upload Changed Files**<br>`devkit.sftp.upload.changedFiles` | Open a configured Git project, select changes in Source Control or run this command for its changes. It uploads current local contents and applies supported rename/delete changes after confirmation. |
| **Upload File Changed (Pick Commit)**<br>`devkit.sftp.upload.fileChanged` | Choose the repository, then a recent commit or uncommitted changes. It uploads current local versions of the created/modified paths in that selection—not historical file contents; deleted paths are skipped. Review the destination summary before confirming. Transfer errors show a separate failed count: choose Show details to inspect output or Retry failed to confirm and retry only those files. |
| **Upload Active File**<br>`devkit.sftp.upload.activeFile` | Focus the saved local file’s editor and choose this command to upload that file to the configured remote path. |
| **Upload Folder**<br>`devkit.sftp.upload.folder` | Select a local folder, or pick it in the dialog. Its contents are uploaded recursively, respecting ignore rules. |
| **Upload Active Folder**<br>`devkit.sftp.upload.activeFolder` | Focus a local file’s editor and run this to upload its containing folder recursively. |
| **Upload Project**<br>`devkit.sftp.upload.project` | Choose the configured local context from the picker. It uploads that entire context recursively, respecting ignore rules. |
| **Force Upload**<br>`devkit.sftp.forceUpload` | Select the local files/folders or use the picker. It uploads them while bypassing ignore filtering; check the selection for private files first. |
| **Upload File To All Profiles**<br>`devkit.sftp.upload.file.to.allProfiles` | Choose this with the selected local file. It uploads that relative selection to every legacy profile inside the active context, using each profile’s own destination. Review the listed hosts, profiles and local/remote paths, then choose Upload; Cancel transfers nothing. It does not upload to every named context. |
| **Upload Active File To All Profiles**<br>`devkit.sftp.upload.activeFile.to.allProfiles` | Choose this with the file in the active editor. It uploads that relative selection to every legacy profile inside the active context, using each profile’s own destination. Review the listed hosts, profiles and local/remote paths, then choose Upload; Cancel transfers nothing. It does not upload to every named context. |
| **Upload Folder To All Profiles**<br>`devkit.sftp.upload.folder.to.allProfiles` | Choose this with the selected local folder. It uploads that relative selection to every legacy profile inside the active context, using each profile’s own destination. Review the listed hosts, profiles and local/remote paths, then choose Upload; Cancel transfers nothing. It does not upload to every named context. |
| **Upload Active Folder To All Profiles**<br>`devkit.sftp.upload.activeFolder.to.allProfiles` | Choose this with the folder containing the active editor file. It uploads that relative selection to every legacy profile inside the active context, using each profile’s own destination. Review the listed hosts, profiles and local/remote paths, then choose Upload; Cancel transfers nothing. It does not upload to every named context. |
| **Upload Project To All Profiles**<br>`devkit.sftp.upload.project.to.allProfiles` | Choose this with the chosen project context. It uploads that relative selection to every legacy profile inside the active context, using each profile’s own destination. Review the listed hosts, profiles and local/remote paths, then choose Upload; Cancel transfers nothing. It does not upload to every named context. |
| **Force Upload To All Profiles**<br>`devkit.sftp.forceUpload.to.allProfiles` | Select local files/folders and choose this to upload to every legacy profile inside the active context while bypassing ignore filtering. Verify all destinations before confirming. |
| **Download File**<br>`devkit.sftp.download.file` | Select a remote file or its corresponding local file, then choose this to download it into the configured local folder. Without a selection, follow the target picker. |
| **Download Active File**<br>`devkit.sftp.download.activeFile` | Focus the corresponding local file’s editor and run this to replace its local contents with the remote file. |
| **Download Folder**<br>`devkit.sftp.download.folder` | Choose a remote folder through the remote context menu or folder picker. Downloads its contents into the matching local folder. |
| **Download Active Folder**<br>`devkit.sftp.download.activeFolder` | Focus a local file’s editor and run this to download the corresponding remote folder into that local folder. |
| **Download Project**<br>`devkit.sftp.download.project` | Select a configured context. Downloads its remote root into the local context folder, respecting ignore rules. |
| **Force Download**<br>`devkit.sftp.forceDownload` | Select a target or use the picker to download it while bypassing ignore filtering. Existing local files may be replaced. |
| **Sync Local -> Remote**<br>`devkit.sftp.sync.localToRemote` | Select a local folder or configured context and run this to synchronize local contents to the remote destination using syncOption. |
| **Sync Remote -> Local**<br>`devkit.sftp.sync.remoteToLocal` | Select a folder or configured context and run this to synchronize remote contents to the local destination using syncOption. |
| **Sync Both Directions**<br>`devkit.sftp.sync.bothDirections` | Select a folder/context and run this to synchronize both sides using syncOption. Resolve file/folder conflicts before retrying a failed sync. |
| **Diff with Remote**<br>`devkit.sftp.diff` | Select a file (or focus its editor) and run this to compare the local and remote versions in VS Code’s diff editor. |
| **Diff Active File with Remote**<br>`devkit.sftp.diff.activeFile` | Focus a file’s editor and run this to compare it with its corresponding remote file. |
| **List**<br>`devkit.sftp.list` | Choose the server, browse folders, then select a file to download and open it. Selecting the current folder (.) downloads that folder. Ignore rules apply; expanding Remote Explorer alone only lists files. |
| **List Active Folder**<br>`devkit.sftp.listActiveFolder` | Focus a local file and run this to browse its corresponding remote folder. Select a file to download/open, or a folder to download. |
| **List All**<br>`devkit.sftp.listAll` | Browse remote targets including ignored paths. Select a file to download/open or the current folder (.) to download; this command bypasses ignore filtering. |
| **Delete**<br>`devkit.sftp.delete.remote` | Select remote files/folders, or browse to a remote target when no editor/selection is active. Verify the filename and confirm Delete. Removes remote data; deleting the configured remote root is blocked. |
| **Create Folder**<br>`devkit.sftp.create.folder` | Select the destination folder in Remote Explorer or choose a context when prompted. Enter a folder name to create it remotely. |
| **Create File**<br>`devkit.sftp.create.file` | Select a destination folder or choose a context, then enter the filename. Creates a remote file without overwriting an existing one; use SFTP because FTP creation is unsupported. |
| **Reveal in Explorer**<br>`devkit.sftp.revealInExplorer` | Select a remote item and choose this to reveal its corresponding local path in VS Code Explorer. It does not download missing content. |
| **Reveal in Remote Explorer**<br>`devkit.sftp.revealInRemoteExplorer` | Select a local file and choose this to locate its corresponding remote item in SFTP Remote Explorer. |
| **Edit in Local**<br>`devkit.sftp.remoteExplorer.editInLocal` | Right-click a remote file and choose this to download it and open the local copy. Upload edits manually or enable uploadOnSave in that context. |
| **View Content**<br>`devkit.sftp.viewContent` | Right-click a remote file and choose this to open its remote content for viewing, instead of editing the local copy. |
| **Refresh**<br>`devkit.sftp.remoteExplorer.refresh` | Click the Remote Explorer refresh button or choose this function to reload its tree after remote changes. |
| **Refresh Active Remote File**<br>`devkit.sftp.remoteExplorer.refreshActiveFile` | Focus a remote-content editor and click its refresh action to reload the remote content. |
| **Development Tools Kit: SFTP / FTP Functions**<br>`devkit.sftp.menu` | Choose SFTP / FTP in the toolbox to open the complete SFTP function list. Choose a function below; supply a file/folder selection where required. |
| **SFTP: Select Context**<br>`devkit.sftp.selectContext` | Save sftp.json first, run this command and choose a named context. The selected connection and watchers replace the previous active context. |

## Remote database connections and SQL

The toolkit bundles a maintained adaptation of the MIT Database Client connection/dialect source for **MySQL, MariaDB and PostgreSQL**. Database tools use the same engine in VS Code and the terminal. This release includes remote connections, database/schema/table/view browsing, column metadata, row previews and SQL execution. Other upstream engines, table designers, data editing grids, imports and exports are not included.

### Connect from VS Code

1. Click the toolbox Activity Bar icon, expand the **Database** view and click **+** (or use **Database → Add Connection**).
2. In **Connect to server**, enter a connection name, server type, host, port, username, password and initial database. For PostgreSQL, use `postgres` when discovering other databases.
3. Choose **Verified TLS**. Expand **Advanced settings** for a private CA certificate path, operation timeout and row limit. Certificate and hostname/IP verification stay enabled. Plaintext requires explicit confirmation before each network operation.
4. **Save connection** stores the configuration without a network test. **Test connection** checks the current form without saving. **Save & connect** tests, saves and focuses the Database sidebar. Failures appear in the form and preserve your inputs for correction.
5. Passwords are masked and stored only in VS Code SecretStorage; connection metadata is saved globally on this computer, outside the workspace. Right-click a saved connection to **Test**, **Edit** or **Remove** it. Leave an edited password empty to retain the saved password. Edits rotate credential identity, so pending operations against the old identity are rejected.

### Browse and execute SQL

- Expand a saved connection in the **Database** sidebar to list databases. Expand a database to list tables/views; PostgreSQL adds a schema level. Expand a table to see its columns and types, or click its name to preview rows in a grid. The toolbar **Refresh** reloads metadata. Errors appear in the tree with a retry action.
- Choose **Find / filter entries…** (or **More entries…** when truncated) to reach objects outside a capped list. Server-side LIKE filters use `%` for any text and `_` for one character. **Enter exact name** reaches a known database/schema/table when it cannot be listed. Refresh clears the narrowed selection.
- Click **New SQL query** under a database/schema to open a destination-specific SQL editor. Alternatively, **Database → Execute SQL** picks a connection and database and opens the query editor, prefilled from the active `.sql` document/selection when available.
- Write SQL and click **Execute SQL**, or press **Ctrl+Enter / ⌘+Enter**. Confirm the destination in the warning. SQL can modify or delete data; no automatic rollback is applied. Each operation uses a new connection, so transaction/session state does not span runs. MySQL/MariaDB allow one statement per run; PostgreSQL batch behavior follows its protocol.
- Results appear below the query with column headings, rows, explicit `NULL` cells and affected-row counts. Multi-result operations offer a **Result set** selector. Errors and truncation are clearly shown. Forms, SQL and results remain in memory when tabs are hidden; closing the panel discards unsaved input/results. No SQL history or result files are automatically saved.
- Defaults: 15-second operation timeout, 500 rows and 8 MiB of accumulated result data. Advanced settings accept 1–5000 rows and 1000–120000 ms. After a collection limit is reached, extra rows are discarded while SQL continues to completion; later errors still fail. A timeout or broken connection may leave the execution outcome uncertain: inspect server state before retrying writes. These limits bound collected results, not server-side work or a single protocol field.

| Command palette entry | Command ID | Use |
|---|---|---|
| Database Tools | `devkit.database.menu` | Open the database function menu. |
| Add Connection | `devkit.database.add` | Open the connection form to save/test an independent connection. |
| Browse Databases | `devkit.database.browse` | Browse databases, schemas, tables, views, columns and row previews. |
| Execute SQL | `devkit.database.query` | Open the SQL editor; selected/all active SQL text prefills it. |
| Test Connection | `devkit.database.test` | Connect and run `SELECT 1`. |
| Edit Connection | `devkit.database.edit` | Open an existing connection in the form; save or test changes. |
| Refresh Databases | `devkit.database.refresh` | Clear filters and refresh the database tree. |
| Remove Connection | `devkit.database.remove` | Remove saved metadata and password after confirmation; the server database is untouched. |

All palette titles begin **Development Tools Kit Database:**. Database connections require a trusted workspace. Operations report progress, return bounded errors without raw SQL/passwords, and fail on timeout or certificate errors. Direct database TCP/TLS connections are supported; for an SSH-only database, establish a trusted system SSH tunnel separately and connect through it using a certificate matching the configured endpoint. This release does not configure database tunnels automatically.

### Use from the terminal

Create `connection.local.json` with no password value:

```json
{
  "type": "postgres",
  "host": "db.example.com",
  "port": 5432,
  "user": "reader",
  "database": "app",
  "tls": true,
  "passwordEnv": "APP_DB_PASSWORD",
  "timeout": 15000,
  "maxRows": 500
}
```

Set `APP_DB_PASSWORD` using your local environment/secret manager. The toolkit never prints it. PostgreSQL does not fall back to `PGPASSWORD`, `.pgpass` or ambient database/SSL settings; an omitted CLI password reference means an explicitly empty password. Missing UI SecretStorage entries require re-entering the password before any connection. Use `caPath` for a private CA certificate. For MySQL/MariaDB, use type `mysql`/`mariadb`, port `3306` and your database name.

```sh
node cli.js database test --config connection.local.json
node cli.js database databases --config connection.local.json
node cli.js database schemas --config connection.local.json
node cli.js database tables --config connection.local.json --schema public
node cli.js database tables --config connection.local.json --schema public --filter "user%"
node cli.js database columns --config connection.local.json --schema public --table users
node cli.js database preview --config connection.local.json --schema public --table users
node cli.js database query --config connection.local.json --sql-file query.sql --yes
```

For MySQL/MariaDB, `--schema` means the database name. Query execution requires `--yes` because arbitrary SQL may modify data. A configuration with `tls: false` additionally requires `--allow-plaintext`. CLI failures exit nonzero, including missing credentials and TLS/SQL errors. JSON results go to stdout; redirect them only when you intend to save database data. `node cli.js database --help` lists every terminal action. Row limits accept 1–5000 and timeouts 1000–120000 ms.

The original copyright/license and precise upstream revision mapping are retained in `vendor/database-client/LICENSE` and `vendor/database-client/provenance.json`. The toolkit remains MIT-licensed; bundled runtime dependencies retain their own licenses in the packaged third-party license file.

### Git repository selection and test scope

Select a repository from VS Code Source Control or browse to its project folder. Subfolders and linked worktrees are supported. If you select a parent folder, the toolkit offers repositories in its immediate project folders (bounded to 200 direct folders; no recursive drive scan). A ZIP/FTP copy without `.git` cannot supply commit history. A valid empty repository remains selected and explains that a first commit is needed. Git ownership protections remain active.

The project release tests include the repository-selection host bridge and rendered text/Git webview. The Git integration group enforces 100% function coverage for `src/data/git.js`, `src/data/local-files.js` and `src/logic/git-compare.js`. Use Node.js 24 for development/release coverage tests (validated with 24.20.0); the published extension runtime requirement is unchanged. This scoped coverage does not establish complete function or branch coverage for every toolkit module; imported TypeScript/bundled code requires separate coverage attribution.
