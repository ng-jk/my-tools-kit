# Development Tools Kit — user guide

Open the **Development Tools Kit** toolbox icon in VS Code’s Activity Bar, then choose a tool. This guide shows how to configure and use each function.

[Release notes](CHANGELOG.md) · [Report a problem](https://github.com/ng-jk/my-tools-kit/issues) · [Source code](https://github.com/ng-jk/my-tools-kit)

## Install and open

1. In VS Code, open **Extensions** and search for **Development Tools Kit** by **NGJUNKAI**. Install the available Marketplace version.
2. To test a newer local build, use **Extensions → … → Install from VSIX…**, choose `development-tools-kit.vsix`, then reload VS Code.
3. Click the toolbox icon in the Activity Bar. The Tools list contains **API Debugger**, **JSON Formatter**, **Compare Text / Files**, **Compare Git Revisions**, **SFTP / FTP**, and **CI/CD Pipeline**.
4. Alternatively, press **Ctrl+Shift+P** (macOS: **Cmd+Shift+P**) and search for **Development Tools Kit** or **SFTP**.

Requires VS Code 1.96+. FTP/SFTP dependencies are bundled. Git comparisons require Git. CI/CD requires Python 3.11+ and the test/build CLIs configured for your project. Trust your workspace to enable the extension. The context features below belong to the 0.5.0 candidate; an older installed version may not contain them.

## Separate FTP/SFTP contexts

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

SFTP verifies host keys: use a trusted `knownHostsPath` or independently verified `hostFingerprint`. Keep `.vscode/sftp.json` out of Git if it contains credentials. Config can also use separate SSH keys, passphrases, agent settings and jump-host configuration per context. Existing single-object and array configurations still work; the named-context format above is recommended when connections share a local folder. Legacy `profiles` inherit their parent settings; use independent contexts when you need complete separation.

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
| Upload Git changes | Use **Upload Changed Files** for staged/working-tree changes, or **Upload File Changed** to select a commit’s changed files. Review deletions before confirming. |
| Watch local changes | Set `watcher.files`, `watcher.autoUpload`, and optionally `watcher.autoDelete` inside the context. Saving its configuration recreates the watcher. |
| Connect with SSH | Choose the SSH terminal action for the selected SFTP server; requires your system SSH client. |
| Stop or troubleshoot | Choose **Cancel All Transfers**, **Show Output**, or Remote Explorer’s refresh button. |

**Force Upload/Download** bypass ignore filtering. **Upload to All Profiles** addresses legacy profiles inside the active context; it never means all independent contexts. Use a disposable folder before enabling automatic deletion. FTP file creation and destructive FTP sync-down are blocked where FTP cannot provide the required safety guarantees; use SFTP for those operations. [Full command inventory and protocol limits](https://github.com/ng-jk/my-tools-kit/blob/developement/docs/sftp.md).

### FTP/SFTP from a terminal

The commands below run from a source checkout with Node.js 20+, `npm ci` and `npm run build:sftp`. VS Code uses the bundled version of the same engine.

```sh
node cli.js sftp config /path/to/project
node cli.js sftp profiles /path/to/project
node cli.js sftp list /path/to/project --context development
node cli.js sftp upload /path/to/project src/app.js --context development
node cli.js sftp download /path/to/project src/app.js --context staging
node cli.js sftp sync-up /path/to/project --context development
node cli.js sftp diff /path/to/project src/app.js --context development
node cli.js sftp watch /path/to/project --context development
node cli.js sftp --help
```

Paths are relative to the context’s local/remote roots. `--context` selects only that invocation and leaves `activeContext` unchanged. Use `--yes` only for intended destructive operations; Ctrl+C cancels/disconnects.

## API Debugger

### Send your first request

1. Choose **API Debugger** from the toolbox.
2. Click **＋** to add a request; give it a name, select **GET**, and enter your endpoint URL.
3. In **Headers & query**, enter JSON objects, for example headers `{"Accept":"application/json"}` and query `{"page":"1"}`.
4. Click **Send**. Read status and duration above **Response**, then switch between **Body**, **Headers**, **Tests**, and **Logs**. Use **Cancel** to stop a pending request.
5. Click **Save** under Collection to keep your requests. **Save response** writes the response to a file.

### Bodies and authentication

For POST/PUT/PATCH, open **Body**, choose **JSON**, and enter a JSON object. Other choices accept text/XML/GraphQL, URL-encoded form objects, multipart field arrays, or a project-relative binary file path. Choose **None** when no body is needed.

Open **Auth**, select a method, and enter the JSON shown by its hint:

| Method | Example fields |
| --- | --- |
| Bearer | `{"token":"{{secret.TOKEN}}"}` |
| Basic | `{"username":"user","password":"{{secret.PASSWORD}}"}` |
| API key | `{"name":"X-API-Key","value":"{{secret.KEY}}","in":"header"}` |
| OAuth 2 client credentials | `{"tokenUrl":"https://example.com/token","clientId":"client","clientSecret":"{{secret.CLIENT_SECRET}}","scope":"read"}` |

Click **Store secret securely** to save a named secret in VS Code SecretStorage. Use `{{secret.NAME}}` in the request. For reusable values, enter an environment JSON object such as `{"baseUrl":"https://example.com"}` and use `{{baseUrl}}` in URLs. **Load env / Save env** manage environment files; keep credential files local and out of Git.

### Tests, collections and imports

- Open **Tests** and add assertions with the controls, then send the request and inspect the **Tests** response tab.
- Add multiple requests with **＋**, save the collection, and choose **Run collection** to run it sequentially. Use **Duplicate**, **Delete request**, and the request search to organize it.
- Use **Import / Open** for native collections, supported Postman/Thunder Client data, or OpenAPI endpoints. Inspect import warnings; scripts/assertions may not migrate completely. **Export Postman** and **Copy cURL template** are partial exports.
- In **Advanced**, set timeout, redirects, response extraction and TLS files as needed. Extraction entries such as `[{"variable":"id","path":"data.id"}]` make response values available to later requests.
- **Scripts** supports trusted pre/post scripts when explicitly enabled. Scripts run with local process privileges; only enable your own trusted code.

### Run the same request in a terminal

Use **Save request for CLI**, then run from a toolkit source checkout:

```sh
node cli.js send request.json --env environment.local.json --out response.json
node cli.js run collection.json --json results.json --junit results.xml
```

CLI secrets can use `{{env.NAME}}`. Collection reports return a failing exit code for failed assertions. Saved single-request responses may contain sensitive data. Add `--allow-scripts` only when you intend to run trusted scripts.

This is not full Thunder Client parity: interactive OAuth, Digest/NTLM/AWS auth, proxies, WebSockets/gRPC and complete script migration are not implemented.

## JSON Formatter

1. Choose **JSON Formatter** from the toolbox.
2. Paste JSON or load a file. Choose two spaces, four spaces, or tabs.
3. Click **Format** for readable JSON, **Minify** for compact JSON, or **Validate** to check syntax.
4. Copy/save the result, open it in an editor, or send it to either comparison side. **Undo tool edit** restores the preceding tool result.

Invalid input is retained with an error. Formatting preserves large numbers, key order, duplicate keys and number spelling; it changes whitespace only. It accepts strict JSON, not comments or trailing commas. To format an existing editor, run **Format JSON Document or Selection** from the Command Palette. It formats the selection, or the entire document if nothing is selected.

```sh
node cli.js json input.json --indent 4 --out formatted.json
node cli.js json input.json --minify
node cli.js json input.json --validate
```

## Compare two long pastes or two files

1. Choose **Compare Text / Files**.
2. Paste text into **Original** and **Modified**, or use each side’s **Paste / Load file** buttons. Use **Swap** if the sides are reversed.
3. Optionally normalize JSON/line endings or ignore case/outer whitespace.
4. Click **Compare texts** or press **Ctrl/Cmd+Enter**. VS Code opens a native diff editor with immutable snapshots.
5. Use the diff editor’s next/previous change arrows, search and inline/side-by-side controls. Return to the tools tab to change inputs and compare again.

For files, run **Compare Two Files** and pick both files, or select two files in Explorer and use its comparison command. To compare a selected editor passage with your clipboard, right-click and choose **Compare Editor or Selection with Clipboard**. Source files stay unchanged. Pasted text is session-local and is not restored after restarting VS Code.

Binary/non-UTF files display size, SHA-256 identity and a hex excerpt; this does not visually compare PDFs/images/Office files. Text comparison supports up to 20 MiB per side. Check the native diff editor’s **Ignore Trim Whitespace** setting when whitespace matters.

```sh
node cli.js compare before.txt after.txt
node cli.js compare before.txt after.txt --ignore-case --line-endings
```

CLI comparison returns 0 for equal, 1 for different, and 2 for an execution error. `compare - -` accepts a JSON object with `left` and `right` strings on stdin for long pastes.

## Compare any two Git revisions

1. Choose **Compare Git Revisions**, then **Select repository…**.
2. Enter a branch, tag, commit hash, or expression such as `HEAD~1` on each side. For example, original `HEAD~1`, modified `HEAD` compares the last commit.
3. Use **WORKTREE** on the right for local tracked/untracked changes or **INDEX** for staged changes.
4. Click **Show changed files**, filter the list, then click a file to see its diff. Renames use the old and new paths; additions/deletions have an empty side.
5. Expand **Compare specific files** to compare different file paths from the two revisions.

No checkout is needed. The tool does not fetch, stage, commit or modify your files. If Git reports dubious ownership, verify that you trust the repository and configure Git’s `safe.directory` for that exact path yourself.

```sh
node cli.js git-changes . HEAD~1 HEAD
node cli.js git-compare . HEAD~1 HEAD old/path.txt new/path.txt
node cli.js git-compare . HEAD WORKTREE src/app.js src/app.js
```

## CI/CD Pipeline

1. Open the project you want to test/deploy. Choose **CI/CD Pipeline** from the toolbox.
2. Set **Development Tools Kit: Python Path** (`devkit.pythonPath`) if Python is not discovered.
3. Configure that project’s `.devkit-pipeline.json` with its actual architecture, unit, function, integration and build commands. Each project needs its own configuration; installing this extension does not automatically configure a website deployment.
4. Use **Status** to inspect branches and evidence, then run the check/test actions. Each action opens a VS Code task showing the same Python CLI output and exit status as terminal execution.
5. Commit development work before **Test**. After automated tests and AI review pass, install the retained build and perform your interface acceptance checks.
6. Use **Approve interface and finish release** only after accepting that exact candidate. If `autoPublishAfterUat` is true, deployment checks and publication start automatically; otherwise invoke **Publish** separately.

The branch flow is **developement → test → deployment → main**. `test` records the candidate on the test branch and runs gates; a test branch alone is not evidence of a passing build. `publish` reruns deployment checks, uploads the approved artifact when Marketplace is configured, verifies it publicly, then promotes main. Failed gates leave main unchanged. AI review uses an installed/authenticated Codex or Claude CLI and blocks release if unavailable or rejected. The user performs interface acceptance; the pipeline never fabricates it.

```sh
python pipeline.py init
python pipeline.py status
python pipeline.py check
python pipeline.py test --push
python pipeline.py accept-uat --commit <tested-sha> --reviewer "Your name" --note "Actual checks completed"
python pipeline.py publish
```

These examples run from the toolkit checkout; `node cli.js pipeline status /path/to/project` targets another configured project. The pipeline runs locally, uses Python orchestration and your project’s CLI tools, and requires the PC/terminal to remain running. It uses no GitHub Actions.

### Publishing this extension

The repository is configured for publisher `NGJUNKAI`. Authenticate Azure CLI locally using your Entra tenant and a publisher Contributor/Owner identity. **Verify Marketplace access** (or `python pipeline.py marketplace-check`) checks access without uploading. Publication uses local `vsce --azure-credential`; credentials stay in the local Azure login cache, outside Git. VS Code clients receive Marketplace releases according to their extension auto-update settings.

[Detailed build, release and recovery instructions](https://github.com/ng-jk/my-tools-kit/blob/developement/docs/development.md).

### Codex / Claude Code pipeline plugin

The separate `pipeline-configurator-0.3.1.zip` build contains the shared Python runtime and `configure-pipeline` skill; it is not installed by the VS Code extension. In a source checkout, `python scripts/build.py` builds it. For Claude Code local testing, run `claude --plugin-dir ./plugins/pipeline-configurator`. Project-local skill installation and verification limits are covered in the [development guide](https://github.com/ng-jk/my-tools-kit/blob/developement/docs/development.md). Ask the agent to configure your project’s actual CLI checks; the skill does not grant global permissions or approve UAT.

## Database tools and licensing

Database Client is currently an upstream reference, not a bundled database UI. This extension does not yet provide database connections or query execution. SFTP is bundled from the MIT-licensed vscode-sftp source with the toolkit’s data/logic/interface separation.

Licensed under [MIT](LICENSE). See [third-party notices](THIRD-PARTY-NOTICES.md) and [release notes](CHANGELOG.md).
