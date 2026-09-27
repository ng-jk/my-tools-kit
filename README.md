# Development Tools Kit

A local API debugger, JSON formatter, text/file/Git comparer, CLI runner, and GitHub Actions configurator, packaged as a VS Code extension with a shared Codex / Claude Code pipeline plugin. Extension version 0.2.0; the pipeline plugin remains version 0.1.0.

[Release notes](CHANGELOG.md) · [Source repository](https://github.com/ng-jk/my-tools-kit) · [Issue tracker](https://github.com/ng-jk/my-tools-kit/issues)

## What's included

| Component | Current delivery |
| --- | --- |
| API debugger | VS Code editor and shared CLI runner |
| JSON formatter | Format, minify, validate, and undo without rounding large numbers |
| Comparer | Pasted text, two files, Git revisions, staged changes, and working-tree changes |
| CI/CD configurator | GitHub Actions inspection, preview, apply, validation, and rollback |
| Agent integration | Codex and Claude Code plugin with a self-contained project configuration skill |
| Database and SFTP tools | Separate upstream repository references and optional local checkouts |

## Install the VS Code extension

Build with Node.js 20 or newer:

```sh
git clone https://github.com/ng-jk/my-tools-kit.git
cd my-tools-kit
npm ci
npm test
npm run check
npm run package
code --install-extension dist/development-tools-kit-0.2.0.vsix
```

Or use **Extensions → Install from VSIX…** and select the file in `dist/`.

VS Code 1.96 or newer is required. Runtime code has no third-party package dependencies; npm installs the development and packaging tools. Generated VSIX/ZIP files, dependency caches, local configuration state, and upstream checkouts are excluded from source control. Build packages locally; this repository push does not create a Marketplace listing or a GitHub Release.

Open a project folder, then run **Development Tools Kit: Open API Debugger** from the command palette. For development, open this toolkit folder directly and press F5 using the included launch configuration.

## Text, file and Git comparison

Run **Development Tools Kit: Compare Text / Open Text Tools**, or choose **Text & JSON tools** from the API workspace. No open project is needed for pasted text or JSON.

- Paste into Original and Modified, or use each side's **Paste** / **Load file** buttons. The Paste button handles long clipboard contents directly. Counts show characters and lines.
- Press **Compare texts** or **Ctrl/Cmd+Enter** to open immutable snapshots in VS Code's native diff editor. Use its change arrows, search, inline/side-by-side toggle, and unchanged-region controls. Return to the tools tab to edit or swap the inputs.
- Optional normalization formats JSON, normalizes line endings, trims surrounding spaces, or ignores case. Source files remain unchanged. The native diff viewer also respects your VS Code diff settings; disable its Ignore Trim Whitespace option when inspecting whitespace-only changes.
- **Compare Two Files** opens a file picker. You can also select two files in Explorer and use its Development Tools Kit comparison command. Text is compared as snapshots. Binary/non-UTF files show sizes, SHA-256 hashes, byte-for-byte identity and a hex excerpt around the first difference; this is not a structural PDF/image/Office-document comparison.
- Right-click in an editor for **Compare Editor or Selection with Clipboard**.

For Git, run **Compare Git Revisions** or open the **Git changes** tab:

1. Select a workspace repository or browse to another repository.
2. Set the original and modified revisions using commit hashes, branches, tags, or expressions such as `HEAD~1`. Recent commits are available in the input suggestions.
3. Use `WORKTREE` on the right for tracked local changes plus untracked files, or `INDEX` for staged changes.
4. Show changed files, filter the list, and select a file. Renames compare the old and new paths automatically; additions/deletions use an empty side.
5. Expand **Compare specific files** to choose different paths independently at either revision, even if they are not in the changed-file list.

Git reads local snapshots only: it does not fetch, checkout, stage, commit, or modify files. Git must be installed. Comparisons support up to 20 MiB per side; UTF-8 and BOM-tagged UTF-16 are decoded as text. Working-tree symlinks and submodule directories are not followed. Close older diff tabs to release snapshot memory. Pasted text and snapshots are session-local, are not logged or sent to a server, and are not restored after restarting VS Code.

## JSON formatter

Run **Open JSON Formatter** or select its tab. Paste/load JSON, choose two spaces, four spaces or tabs, then **Format**, **Minify**, or **Validate**. Copy, save, open the result in an editor, or send it to either comparison side. **Undo tool edit** restores the preceding tool result. Invalid input is retained with a syntax error message.

Formatting preserves original number tokens (including integers beyond JavaScript's safe range), exponent notation, string escapes, key order, and duplicate keys. It changes whitespace only. It accepts strict JSON, not JSON-with-comments or trailing commas.

**Format JSON Document or Selection** formats the active selection, or the whole editor if nothing is selected, as one undoable editor edit. The formatter supports input up to 20 MiB, output up to 40 MiB characters, and 256 nesting levels.

## API debugger

- HTTP/HTTPS requests with headers, query parameters, JSON, text, form, multipart, and binary bodies.
- Basic, bearer, API-key, and OAuth 2 client-credentials authentication.
- Environment files, nested variables, secret references, UUIDs and timestamps.
- GUI-built assertions, trusted pre/post scripts, response extraction, and sequential collection runs.
- Response status, timing, headers, JSON/text, test results, logs, and binary downloads.
- Same-origin redirects, host-only cookies, TLS CA/client certificates, cancellation, timeouts, and response limits.
- Native collection JSON, partial Postman/Thunder Client import, OpenAPI endpoint import, and a cURL template.
- CLI runs with JSON and JUnit reports and nonzero exit codes on failures.

Use **Store API Secret** to save a value in VS Code SecretStorage, then reference `{{secret.NAME}}`. The CLI uses `{{env.NAME}}` from process environment variables. Environment values can be loaded/saved separately; use `*.local.json` for credentials and keep those files out of Git. Collection variables are saved with the collection.

Try the local demo in two terminals:

```sh
node examples/server.js
```

```sh
node cli.js run examples/collection.json --json dist/results.json --junit dist/results.xml
```

Import `examples/collection.json` in the editor to use the same requests.

Trusted scripts require the editor checkbox or CLI `--allow-scripts`. They run in a time-limited worker with local process privileges, not a security sandbox. Only run scripts you trust. Reports omit response bodies, headers, variable values, raw errors and script logs to avoid copying credentials into CI artifacts.

## CI/CD configurator

Run **Development Tools Kit: Configure CI/CD** in VS Code, or use the CLI:

```sh
node cli.js pipeline inspect /path/to/project
node cli.js pipeline plan /path/to/project --agents codex,claude --out plan.json
node cli.js pipeline apply /path/to/project --plan plan.json
node cli.js pipeline check /path/to/project
```

The plan contains exact before/after file contents and findings. Apply rejects changed inputs and modified plans. It creates a dedicated workflow, preserves other workflows, and refuses to overwrite an existing unmanaged or edited file. Repeating the same configuration produces no changes.

Supported roots: npm `package.json`, Python `requirements.txt` or `pyproject.toml`, and PHP `composer.json`. CI uses actual declared Node/PHP scripts. Set a verified Python test command in `.devkit-pipeline.json`:

```json
{
  "nodeVersion": "22",
  "pythonTest": "python3 -m pytest"
}
```

Python and PHP use Ubuntu 24.04 runner tooling. Other package managers and specialized runtime versions need custom workflows. Generated `.yml` files use JSON syntax, which is valid YAML and keeps the dependency-free renderer deterministic.

Optional deployment configuration:

```json
{
  "deploy": {
    "environment": "staging",
    "command": "./scripts/deploy.sh",
    "secrets": { "DEPLOY_TOKEN": "STAGING_DEPLOY_TOKEN" }
  }
}
```

Deployment runs only on manual dispatch from the repository's default branch after CI succeeds. The deployment command runs on a fresh checked-out runner and must handle its own build/artifact retrieval. Provision the referenced GitHub secrets and environment protection rules separately. No cloud account or deployment is created by this toolkit.

Keep `.devkit/pipeline-state.json` locally and ignore `.devkit/` in Git. To restore original managed files, run `node cli.js pipeline rollback /path/to/project`; it refuses rollback if files have subsequently changed. Commit the workflow and any generated project-local skills.

## Codex and Claude Code

`plugins/pipeline-configurator` contains both supported host manifests and a self-contained `configure-pipeline` skill. `npm run build` synchronizes the shared source and runtime into that package.

To produce the distributable plugin ZIP after building, run `python scripts/package-plugin.py` with Python 3. It writes `dist/pipeline-configurator-0.1.0.zip`, including both hidden host manifest directories. Python is only required for this ZIP helper, not for using the plugin runtime.

For Claude Code local testing:

```sh
claude --plugin-dir ./plugins/pipeline-configurator
```

The `--agents codex,claude` pipeline option installs the same skill and runtime under the target project's `.agents/skills/` and `.claude/skills/` directories, making it usable without a global marketplace install. Restart or open a new agent session after installing project skills. The skill inspects, plans, applies, checks, and can configure another project's local integration; it does not alter global agent permissions.

The plugin has been statically validated; live Claude Code/Codex host loading has not been exercised. See the [Codex plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) and [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference) for host installation options.

## Verification

```sh
npm test
npm run test:ui
npm run check
npm run package
```

`test:ui` uses Playwright with installed Microsoft Edge. Set `DEVKIT_BROWSER=chrome` to use installed Chrome. It tests the webview in a browser with the VS Code message bridge simulated; it is not a native VS Code extension-host test.

The v0.2.0 verification suite contains 27 core/integration tests and two browser tests. The checked-in GitHub Actions workflow runs syntax checks, core/integration tests, and the plugin build on Node.js 22. Browser tests require a locally installed supported browser and are run separately. Native host loading and remote deployments are not covered by these checks.

## Compatibility and limits

This release is usable, but **does not yet provide complete Thunder Client parity**. Digest/NTLM/AWS authentication, interactive OAuth flows, proxy configuration, WebSockets/gRPC, full migration of scripts and assertions, cookie domain sharing, rich code generators, and MCP API tools are not implemented. Folder defaults execute in the CLI; the editor flattens imported folders and warns before saving. cURL and Postman export are partial and identify their limitations.

The pipeline backend currently supports GitHub Actions and root-level projects. It validates generated structure and repository consistency locally; actual hosted CI runs and deployments require a real remote repository and configured credentials.

## Repository references

Upstream revision references are recorded in `docs/repositories.json`. Optional local checkouts live in `repositories/vscode-database-client` and `repositories/vscode-sftp`. They keep their own histories and remotes, are ignored by this repository, and are not bundled into the VSIX. No modifications to those projects are part of this release.

To restore the optional folders used by `development-tools-kit.code-workspace` after cloning:

```sh
git clone https://github.com/cweijan/vscode-database-client.git repositories/vscode-database-client
git clone https://github.com/ng-jk/vscode-sftp.git repositories/vscode-sftp
```

For the exact reviewed revisions, check out the commit IDs recorded in `docs/repositories.json` inside the respective clones. You can also open the toolkit root directly without cloning either upstream repository.

- [Database Client](https://github.com/cweijan/vscode-database-client): upstream states this repository is the early source and newer versions are closed source.
- [SFTP plus](https://github.com/ng-jk/vscode-sftp): requested repository, checked out at version 1.16.3.

Architecture and acceptance details are in `api-debugger/README.md`, `pipeline-configurator/README.md`, and `docs/roadmap.md`.
