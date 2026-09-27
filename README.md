# Development Tools Kit

A local API debugger, JSON formatter, text/file/Git comparer, and Python terminal CI/CD pipeline, packaged as a VS Code extension with a shared Codex / Claude Code plugin. Extension version 0.3.0; pipeline plugin version 0.2.0. No GitHub Actions are used.

[Release notes](CHANGELOG.md) · [Source repository](https://github.com/ng-jk/my-tools-kit) · [Issue tracker](https://github.com/ng-jk/my-tools-kit/issues)

## What's included

| Component | Current delivery |
| --- | --- |
| API debugger | VS Code editor and shared CLI runner |
| JSON formatter | Format, minify, validate, and undo without rounding large numbers |
| Comparer | Pasted text, two files, Git revisions, staged changes, and working-tree changes |
| CI/CD pipeline | Python CLI and VS Code tasks: AI review, unit/function/integration tests, human UAT, branch promotion |
| Agent integration | Codex and Claude Code plugin with a self-contained project configuration skill |
| Database and SFTP tools | Separate upstream repository references and optional local checkouts |

## Install the VS Code extension

Build with Node.js 20+, Python 3.11+, and Git:

```sh
git clone https://github.com/ng-jk/my-tools-kit.git
cd my-tools-kit
npm ci
npm test
npm run check
python scripts/build.py
npm run package
code --install-extension dist/development-tools-kit.vsix
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

Use **Save request for CLI** in the editor to create a single request JSON object. `node cli.js send request.json --env environment.local.json --out response.json --download body.bin` exposes response headers, body, assertions, and timing from the same executor as the UI. Ctrl+C cancels execution. Single-request output intentionally includes the response and can contain secrets; keep saved debug output private. `node cli.js curl request.json` produces the same partial cURL template as the editor. **Export Postman** and `node cli.js export collection.json --out postman.json` use the same exporter and compatibility warnings.

Trusted scripts require the editor checkbox or CLI `--allow-scripts`. They run in a time-limited worker with local process privileges, not a security sandbox. Only run scripts you trust. Reports omit response bodies, headers, variable values, raw errors and script logs to avoid copying credentials into CI artifacts.

## CI/CD configurator

Run **Development Tools Kit: Configure CI/CD** in VS Code. Each menu action launches the same Python entry point as the terminal and exposes its output and exit status in a VS Code task. On Windows use `py -3` if `python` is unavailable; alternatively set `DEVKIT_PYTHON` or the VS Code `devkit.pythonPath` setting to your interpreter.

```sh
python pipeline.py init
python pipeline.py status
python pipeline.py check
# After committing changes to developement:
python pipeline.py test --push
# Only after personally completing interface acceptance for that exact commit:
python pipeline.py accept-uat --commit <sha> --reviewer "Your name" --note "Actual UAT checks completed"
# When ready to publish:
python pipeline.py publish
```

Branch flow is **developement → test → deployment → main**. `init` creates missing local branches from `main`; it never overwrites existing branches. `check` runs architecture, unit, function, integration, and package checks on current changes without producing release evidence. `test` pins the committed development SHA in a temporary detached worktree, installs locked dependencies, runs those gates plus AI review, and retains the report and build artifacts. `--push` also updates the remote test branch.

Configuration is checked in as `.devkit-pipeline.json`. Commands are argument arrays, executed without a shell; `{python}` selects the interpreter running the pipeline. Required command groups are `prepare`, `architecture`, `unit`, `function`, `integration`, and `build`. Keep actual test commands in every group. The default AI reviewer is the authenticated Codex CLI; set `reviewer` to `claude` to use Claude Code. Both run from a normal terminal. AI review is real and required: missing authentication, missing executables, malformed results, rejection, and high/critical findings fail the gate.

`publish` requires a clean checkout, matching local/remote main, a passing test report, and your UAT acceptance bound to that report and exact SHA. It pushes the candidate to `deployment`, reruns all gates, and only then fast-forwards `main`. Failure leaves main unchanged. No force pushes or gate-skipping options are provided. Development/test/deployment branches are retained; your current checkout remains on development. Git authentication retries use existing credentials for at most three attempts and verify the remote after an uncertain push.

Reports, retained VSIX/ZIP artifacts with SHA-256 hashes, UAT records, and an operation lock live under the Git common directory's `devkit/` folder. `status` prints its location. Rerunning test invalidates prior UAT. Evidence is local and authenticated to detect edits; it is not a security boundary against the same OS user or direct Git pushes. Another machine must retest and record acceptance. If a process crashes, verify no pipeline is running before removing its stale `pipeline.lock`.

Publication currently means package creation and Git branch promotion. No external hosting target, marketplace upload, or GitHub Release is configured. The old generated Actions workflow has been removed. Existing repositories must migrate their configuration to this Python format; old inspect/plan/apply/rollback commands are no longer available.

## Shared layers and terminal tools

| Layer | JavaScript product | Python pipeline |
| --- | --- | --- |
| Data | `src/data`: files, HTTP, Git subprocesses, script workers | `cicd/data`: Git, processes, configuration, evidence, AI CLI adapters |
| Logic | `src/logic`: API execution, assertions, JSON and comparison behavior | `cicd/logic`: test, UAT, promotion policies and orchestration |
| Interface | `src/interface`: VS Code and terminal adapters | `cicd/interface`: terminal parsing and JSON output |

Logic never imports VS Code or the interface layer. Data never imports logic or interface. `python scripts/architecture.py` checks these boundaries. Root entry points and `lib/` modules are compatibility adapters. The core suites run without opening VS Code or a browser; interface UAT is performed by you.

```sh
node cli.js json input.json --indent 4 --out formatted.json
node cli.js json input.json --minify
node cli.js json input.json --validate
node cli.js compare original.txt modified.txt --line-endings
node cli.js git-changes . HEAD~1 HEAD
node cli.js git-history .
node cli.js git-files . HEAD
node cli.js git-compare . HEAD~1 HEAD old/path.txt new/path.txt
node cli.js pipeline status .
```

`json -` reads stdin. `compare - -` reads a JSON object with `left` and `right` strings from stdin, supporting two long pastes without command-line length limits. File comparison supports `--json`, `--ignore-case`, `--trim-whitespace`, and `--line-endings`. `git-compare` accepts `INDEX` or `WORKTREE` on the right and `-` for a missing file. Compare outputs include both snapshots and `identical`; exit 0 means equal, exit 1 means different, and exit 2 means execution failed. Other tools and pipeline commands use exit 0 for success and nonzero for failure. Clipboard buttons, undo, and native diff navigation are UI interactions around these same core functions.

## Codex and Claude Code

`plugins/pipeline-configurator` contains both host manifests and a self-contained `configure-pipeline` skill. `python scripts/build.py` synchronizes the Python runtime and shared skill and writes `dist/pipeline-configurator-0.2.0.zip`.

Python is required to run the pipeline. The plugin includes no third-party Python dependencies. Its skill configures actual project CLI checks and project-local agent integration, preserves existing customizations, and never grants itself global permissions or fabricates UAT approval.

For Claude Code local testing:

```sh
claude --plugin-dir ./plugins/pipeline-configurator
```

For project-local discovery, copy `plugins/pipeline-configurator/skills/configure-pipeline` to `.agents/skills/configure-pipeline` for Codex or `.claude/skills/configure-pipeline` for Claude Code. Open a new agent session to discover it. The skill describes configuration migration and setup for another repository; the UI expects its `.devkit-pipeline.json` to exist.

The plugin has been statically validated; live Claude Code/Codex host loading has not been exercised. See the [Codex plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) and [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference) for host installation options.

## Verification

```sh
npm test
python -m unittest discover -s tests/pipeline -v
python scripts/architecture.py
npm run check
python scripts/build.py
npm run package
```

`npm run test:interface` and `npm run test:ui` are optional developer diagnostics, excluded from release gates. `test:ui` uses Playwright with installed Microsoft Edge (or `DEVKIT_BROWSER=chrome`) and a simulated VS Code bridge; neither substitutes for your acceptance testing.

The automated suites cover API wire behavior, JSON precision, long pastes, Git snapshots, CLI exit codes, failed release gates, evidence tampering, stale UAT, and a complete branch-promotion simulation using an isolated local bare remote and a fixture reviewer. Fixture reviewers are only for isolated tests; production test/publish commands always invoke the configured real AI CLI.

## Compatibility and limits

This release is usable, but **does not yet provide complete Thunder Client parity**. Digest/NTLM/AWS authentication, interactive OAuth flows, proxy configuration, WebSockets/gRPC, full migration of scripts and assertions, cookie domain sharing, rich code generators, and MCP API tools are not implemented. Folder defaults execute in the CLI; the editor flattens imported folders and warns before saving. cURL and Postman export are partial and identify their limitations.

The pipeline is an explicitly invoked local CLI, not a continuously running server. Keep the terminal open until it completes. Live AI review needs installed/authenticated Codex or Claude Code; remote publication needs origin push access. Python orchestrates native project test/build CLIs; the VS Code product itself remains JavaScript.

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
