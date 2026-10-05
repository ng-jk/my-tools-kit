# Development and release operations

For end-user steps, see the [tool user guide](../README.md).

## Build a local extension package

Run in the toolkit checkout with Node.js 20+, Python 3.11+ and Git installed:

```sh
npm ci
python pipeline.py check
code --install-extension dist/development-tools-kit.vsix
```

`check` includes packaging but produces no release approval. For commit-bound release evidence, follow test, UAT and publish below.

## CI/CD configurator

Run **Development Tools Kit: Configure CI/CD** in VS Code. Each menu action launches the same Python entry point as the terminal and exposes its output and exit status in a VS Code task. On Windows use `py -3` if `python` is unavailable; alternatively set `DEVKIT_PYTHON` or the VS Code `devkit.pythonPath` setting to your interpreter.

```sh
python pipeline.py init
python pipeline.py status
python pipeline.py marketplace-check
python pipeline.py check
# After committing changes to developement:
python pipeline.py test --push
# Only after personally completing interface acceptance for that exact commit:
python pipeline.py accept-uat --commit <sha> --reviewer "Your name" --note "Actual UAT checks completed"
# Automatic publication follows UAT in this repo. Retry a failed publication with:
python pipeline.py publish
```

Branch flow is **developement → test → deployment → main**. `init` creates missing local branches from `main`; it never overwrites existing branches. `check` runs architecture, unit, function, integration, and package checks on current changes without producing release evidence. `test` pins the committed development SHA in a temporary detached worktree, installs locked dependencies, runs those gates plus AI review, and retains the report and build artifacts. `--push` also updates the remote test branch.

Configuration is checked in as `.devkit-pipeline.json`. Commands are argument arrays, executed without a shell; `{python}` selects the interpreter running the pipeline. Required command groups are `prepare`, `architecture`, `unit`, `function`, `integration`, and `build`. Keep actual test commands in every group. The default AI reviewer is the authenticated Codex CLI; set `reviewer` to `claude` to use Claude Code. Both run from a normal terminal. AI review is real and required: missing authentication, missing executables, malformed results, rejection, and high/critical findings fail the gate.

`publish` requires a clean checkout, matching local/remote main, a passing test report, and your UAT acceptance bound to that report and exact SHA. It pushes the candidate to `deployment`, reruns all gates, and only then fast-forwards `main`. Failure leaves main unchanged. No force pushes or gate-skipping options are provided. Development/test/deployment branches are retained; your current checkout remains on development. Git authentication retries use existing credentials for at most three attempts and verify the remote after an uncertain push.

Reports, retained VSIX/ZIP artifacts with SHA-256 hashes, UAT records, and an operation lock live under the Git common directory's `devkit/` folder. `status` prints its location. Rerunning test invalidates prior UAT. Evidence is local and authenticated to detect edits; it is not a security boundary against the same OS user or direct Git pushes. Another machine must retest and record acceptance. If a process crashes, verify no pipeline is running before removing its stale `pipeline.lock`.

Marketplace publication is configured for `NGJUNKAI.development-tools-kit`. After deployment gates pass, the pipeline uploads the exact VSIX retained from your UAT-approved test run, verifies the published version and its extension payload, and only then advances main. The separately built agent-plugin ZIP is not uploaded to the VS Code Marketplace. No GitHub Release or other hosting target is configured. The old generated Actions workflow has been removed; legacy inspect/plan/apply/rollback commands are no longer available.

## Marketplace setup and recovery

Install [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-windows), then sign in locally with `az login --tenant <tenant-id> --allow-no-subscriptions`. Your Entra identity needs Contributor or Owner access on the Marketplace publisher. Run `npm ci` in the toolkit root to install its locked `vsce` dependency. `python pipeline.py marketplace-check` or **Verify Marketplace access** in VS Code checks authentication and publisher access without uploading. This check alone does not prove write permission; upload additionally requires Contributor/Owner. Microsoft may periodically require interactive login/MFA again. No PAT, client secret, or GitHub Actions is needed for this PC-based workflow.

`.devkit-pipeline.json` contains only public Marketplace configuration: `publisher`, `tenantId`, and `artifact`. PAT environment overrides are removed for publishing subprocesses; Entra login caches stay outside Git. The standard Windows Azure CLI installation directory is discovered even when the desktop app has an older PATH. Do not put tokens or Azure configuration caches in the repository. The extension's version must be committed before testing; publish never bumps it or rebuilds the approved VSIX.

Before upload, the pipeline checks for the exact Marketplace version. Matching extension files allow recovery without another upload; different contents block main promotion. Marketplace may add signatures to the outer VSIX container, so remote verification compares the complete `extension/` payload and identity rather than the whole ZIP hash. Local UAT evidence still checks the exact ZIP SHA-256. Verification is limited to 100 MiB compressed and unpacked packages.

An authenticated local receipt is written before upload. If upload times out, or Microsoft scanning/indexing is pending, main stays unchanged. Run publish again to check the existing attempt; it will not blindly reupload. If the version remains absent, inspect **Manage Publishers → Extensions** for validation errors. Keep the receipt; either resolve the pending Marketplace operation or commit a new version and repeat test/UAT. Once Marketplace succeeds, a failed main push can be retried without duplicate publication. If the remote main push succeeded but the local update failed, publish can reconcile local main from its recorded deployment and UAT evidence. Publication cannot be rolled back automatically when Git fails afterward.

Read [what each CI/CD action does and its project prerequisites](pipeline-usage.md).

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

For mixed input, `compare - file.txt` and `compare file.txt -` read raw text/bytes from stdin for the `-` side. Git comparison fails if neither selected path exists, so a path typo cannot appear as a successful equality result.

## Codex and Claude Code

`plugins/pipeline-configurator` contains both host manifests and a self-contained `configure-pipeline` skill. `python scripts/build.py` synchronizes the Python runtime and shared skill and writes `dist/pipeline-configurator-0.3.1.zip`.

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

Upstream revision references are recorded in `docs/repositories.json`. Optional original checkouts live in `repositories/vscode-database-client` and `repositories/vscode-sftp`, retain their own histories/remotes, and are ignored by this repository. SFTP source has now been imported into the toolkit layers and is bundled; its revision and mapping are in `vendor/sftp/provenance.json`. Database Client remains an unbundled reference.

To restore the optional folders used by `development-tools-kit.code-workspace` after cloning:

```sh
git clone https://github.com/cweijan/vscode-database-client.git repositories/vscode-database-client
git clone https://github.com/ng-jk/vscode-sftp.git repositories/vscode-sftp
```

For the exact reviewed revisions, check out the commit IDs recorded in `docs/repositories.json` inside the respective clones. You can also open the toolkit root directly without cloning either upstream repository.

- [Database Client](https://github.com/cweijan/vscode-database-client): upstream states this repository is the early source and newer versions are closed source.
- [SFTP plus](https://github.com/ng-jk/vscode-sftp): requested repository, checked out at version 1.16.3.

Architecture and acceptance details are in `api-debugger/README.md`, `pipeline-configurator/README.md`, and `docs/roadmap.md`.

