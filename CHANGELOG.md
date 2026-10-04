# Release notes

This file records implemented functionality and its verification limits. Extension and pipeline-plugin versions are independent.

## 0.5.0 — 2026-10-04

Extension: **0.5.0**. Pipeline plugin: **0.3.1**.

- Apply ignore rules to every descendant during remote deletion, including watcher autoDelete and terminal deletion; preserve ancestors containing ignored remote-only files.

- Block deletion-based FTP sync-down because LIST cannot guarantee hidden-entry completeness; an omitted dotfile must never be interpreted as permission to delete its local counterpart. Use SFTP for destructive remote-to-local synchronization.

- Reject unparseable FTP listing records before sync can infer deletions. Normalize the SSH port for every jump destination, including the final hop, without mutating configuration.

- Create files exclusively with `wx` so concurrent creation cannot truncate another file. FTP Create File fails explicitly because FTP cannot guarantee exclusive creation of a specified path.

- Protect the entire Git mirror before initialization or backup, including existing object databases: private root mode on Unix and verified recursive private ACLs on Windows. Reject mirror links. Restore and verify Unix staging descriptor modes after open so umask cannot remove destination permission bits.

- Protect Windows staging files before payload writes: new files receive a verified private ACL, and replacement files retain the existing destination DACL. Apply explicit upload directory permissions to all missing parent directories.

- Windows downloads protect newly created directories with verified ACLs for the current user and SYSTEM instead of comparing unrepresentable POSIX modes. Other users do not inherit access to those new directories; existing destination directories retain their ACLs. Unix/remote targets continue using verified mode bits.

- Establish and verify source directory modes (or explicit upload overrides) on new destination directories before payloads, including missing parents. Serialize creation and clean up failed permission setup. Recurse through matching directories with ignoreExisting so new nested files are still copied.

- Reserve remote descriptor slots before issuing open requests and release failed requests, preventing repeated errors or concurrent opens from exhausting the optional limiter.

- Bind each configuration service to its own selected profile, keeping local context, watcher policy and connection destination consistent when configurations have different defaults.

- Check cancellation after symlink reads, after staging completion, and after acquiring the replacement lock, before changing the destination. Once replacement begins, rollback remains enabled.

- UI and CLI now share transfer planning, backup, scheduling and cancellation orchestration. Cancel All Transfers includes transient all-profile sessions and stops later sync mutations after cancellation. Shared connection identity preserves replacement serialization through cancellation guards.

- Cancellation during CLI planning/backup prevents subsequent transfer writes and reports failure. Shared remote connections remain open until all owning services release them; multi-selection all-profile uploads defer cleanup until every item finishes. Interface realpath access uses a data adapter.

- Capture source-stream failures during permission preparation so transfers fail instead of hanging; apply sync exclusions before checking file/directory conflicts.

- Integrate ng-jk/vscode-sftp 1.16.3 source, including all upstream public commands, profiles/contexts, SFTP/FTP/FTPS, remote explorer, Git-change uploads, sync, watchers, temporary uploads, permissions and mirror backups. Preserve upstream licenses and source provenance.

- Add a Development Tools Kit Activity Bar entry with a tool list and embedded SFTP Remote Explorer; namespace SFTP commands to avoid collisions.

- Separate protocol/filesystem data, shared transfer/profile logic, and VS Code/terminal interfaces. Add CLI SFTP operations, environment-based authentication, explicit paths, JSON results and nonzero error exits.

- Require trusted SSH host keys or explicit SHA-256 pins for every hop; reject changed keys. Correct reverse filesystem selection during bidirectional sync, protect normalized root paths from deletion/rename, and preserve SSH remote-command argument order.
- Correct upstream SSH event registration, sync deletion/error handling, scheduler failure propagation, FTP connection timer cleanup, nested credential logging and connection-cache identities.

- Preserve Git ownership checks and disable filesystem monitor hooks in comparison subprocesses; foreign-owned repositories require explicit user-configured trust.

- Permanently decode gzip Marketplace responses with bounded decompression; publication no longer needs the 0.4.0 transport workaround.

- Prevent downloads through destination symlinks, reload watchers on every profile switch, and await Git uploads with correctly mapped remote rename paths.
- Reject unsafe remote listing paths, preserve ignored descendants during sync deletion, correct FTP file creation, and resolve watcher behavior from the selected profile.
- Add local SFTP/FTP wire tests, shared-engine/CLI tests, and sidebar/command host-adapter diagnostics. Advanced server/authentication combinations and native UI acceptance remain environment-specific; no production credentials are needed for automated tests.

- Preserve symlink identity during sync, upload edited rename destinations, resolve all-profile transfers from each profile context, share Git change selection across UI/CLI (including root commits), and stop queued CLI work on cancellation.
- Stage file transfers before replacement, retain/restore the previous destination on replacement failure, close handles after failed reads, replace changed symlinks correctly, and explicitly reject unsupported FTP symlink creation.
- Suppress download-generated watcher events (including delayed replacement events), exclude staging/recovery files, share safe configuration defaults across UI/CLI, and preserve restrictive/executable destination permissions.
- Bound remote rename mapping to its local context, share Git-change transfer planning and mirror policies in logic, and enforce or explicitly reject SSH-terminal trust configurations.
- Preserve each child file mode during recursive transfers, compare symlink targets during sync, and share configuration persistence/environment expansion across UI and terminal adapters.
- Reject FTP control-command delimiters, validate every recursive FTP deletion entry, and apply upload permission overrides only to uploads through shared policy.
- Enforce remote-root deletion/rename protection in shared logic and verify FTP staging permissions before appending payloads, failing when the server cannot honor them.
- Verify effective SFTP staging permissions before payload transfer and reject file/directory sync conflicts instead of reporting an unsupported task as successful.
- Document the complete SFTP command inventory and explain pipeline prerequisites and branch flow.

## 0.4.0 — 2026-10-04

Extension: **0.4.0**. Pipeline plugin: **0.3.0**.

- Set the Marketplace publisher ID to `NGJUNKAI` and adopt the MIT license for this toolkit and its packaged pipeline plugin. Referenced upstream projects retain their own licenses.

- Connect Python publication to the installed vsce CLI using Microsoft Entra ID, with no PAT fallback or repository-stored credentials.

- Add the same read-only Marketplace access check to the CLI and VS Code task menu.

- Upload the exact UAT-approved VSIX after deployment gates pass; verify its public version and complete extension payload before promoting main.

- Journal upload attempts, reject conflicting versions, recover uncertain uploads by reading remote content, and reconcile a completed remote main push after local-update failure. No automatic duplicate uploads or version bumps.

- Include the MIT license in both extension and agent-plugin packages. The agent-plugin ZIP itself is not uploaded to the VS Code Marketplace.

- Add fixture tests for Entra CLI arguments, credential exclusion, manifest identity, Marketplace response validation, upload failure/recovery, version conflicts, branch races, and main-promotion ordering. Live authentication is checked separately; no automated test uploads to the real Marketplace.

## 0.3.0 — 2026-09-27

Extension: **0.3.0**. Pipeline plugin: **0.2.0**.

### Changed

- Replaced the GitHub Actions generator and workflow with Python standard-library CI/CD. No Actions service or workflow is required.

- Implemented `developement -> test -> deployment -> main` with fast-forward-only updates, exact-commit isolated worktrees, required AI review, architecture checks, unit/function/integration tests, and package builds.

- Added human interface UAT evidence tied to the test report and exact commit. Missing, stale, rejected, or failed gates block promotion. Publication reruns gates after pushing deployment and only then advances main.

- Retain signed local reports, SHA-256 artifact hashes, tested VSIX/ZIP packages, and serialized operation locks in the Git common directory. Authentication retries are bounded to three attempts and uncertain pushes verify remote state.

- Split product and pipeline into explicit data/logic/interface layers. Core tests do not load VS Code or a browser; compatibility entry points remain.

- VS Code pipeline actions invoke the same Python CLI as terminal users, with task output and exit status. Codex and Claude Code adapters support terminal AI review; production review never falls back to a fixture.

- Added JSON formatting/minification/validation and file, pasted-text, and Git comparison CLI commands using the same logic as the UI.

- Added single-request CLI debugging, response downloads, cURL templates, Git history/file listing, and the UI option to push the test branch.

- Added Save request for CLI and Export Postman buttons backed by the shared data and export logic.

- Comparison accepts raw stdin on either side of a file comparison and rejects Git comparisons where neither selected path exists.

- Verify worktree HEAD and tracked source before and after every gate. Verify retained artifact hashes before recording UAT and before publication; regression tests cover clean checkout changes and missing/modified packages.

- Updated both agent manifests and the self-configuration skill for Python commands, real test evidence, and user-owned UAT. Plugin builds and ZIP packaging now use Python.

### Verification and release boundaries

- Data/logic and terminal suites include an isolated bare-Git-remote promotion simulation, failed deployment/main-push protection, stale UAT rejection, evidence tampering, exact API wire assertions, JSON precision, long pastes, and Git snapshot comparisons.

- Interface diagnostics remain optional; user acceptance and native host installation are not claimed by automated CLI success.

- Repository publication creates packages and advances Git branches. No marketplace upload, external hosting deployment, or complete Thunder Client parity is claimed.

- Breaking pipeline migration: legacy `inspect/plan/apply/rollback` and Actions configuration are replaced by `init/status/check/test/accept-uat/publish` and `.devkit-pipeline.json` argv groups. Python 3.11+ is now required.

## 0.2.0 — 2026-09-27

Extension: **0.2.0**. Pipeline plugin: **0.1.0**.

### Added

- Text & JSON Tools workspace, accessible from the command palette and API workspace.

- Two large-text inputs with clipboard paste, file loading, character/line counts, swap, wrapping, and Ctrl/Cmd+Enter comparison.

- Read-only comparison snapshots in VS Code's native diff viewer, with its search, change navigation, and inline/side-by-side views.

- Optional JSON formatting, line-ending normalization, surrounding-whitespace trimming, and case normalization before comparison.

- Two-file comparison from a file picker or Explorer context menu, plus editor/selection comparison with the clipboard.

- UTF-8 and BOM-tagged UTF-16 text decoding; binary/non-UTF file summaries with byte identity, sizes, SHA-256 hashes, first differing byte, and a hex excerpt.

- Git comparison of commits, tags, branches, staged changes, and working-tree changes, including untracked files.

- Changed-file filtering, rename-aware paths, empty sides for additions/deletions, recent-commit suggestions, repository browsing, and independent file selection at either revision.

- JSON format, minify, validate, indentation selection, undo, copy, save, and open-in-editor operations.

- Precision-preserving formatting that retains original numeric tokens, exponent notation, string escapes, duplicate keys, and key order.

- Undoable formatting of the active editor's JSON selection or full document.

### Verification

- 27 core/integration tests and two browser tests pass locally on Windows with Node.js 24 and Microsoft Edge.

- Coverage includes 100,000-line core comparison inputs, 20,000-line clipboard inputs through the browser, large JSON integers, invalid JSON retention, Git rename/add/delete behavior, staged versus unstaged contents, and unchanged Git checkout/index state.

- JavaScript syntax and JSON files checked; the toolkit's generated CI configuration passes its consistency check.

- Installable artifact: `dist/development-tools-kit-0.2.0.vsix` from `npm run package`.

### Limits

- Text/file comparisons accept up to 20 MiB per side. Binary output is a diagnostic summary, not a full binary diff or structural comparison of images, PDFs, or Office documents.

- JSON is strict: comments and trailing commas are rejected. Pretty-printing allows 256 nesting levels and at most 40 MiB characters of output.

- Working-tree symlinks and submodule directories are not followed. Git must be available on PATH; remote refs must already exist locally.

- Snapshots and pasted inputs are session-local. VS Code's own diff display settings also apply.

- Browser tests exercise the real handlers with simulated VS Code APIs. Native VS Code host installation has not been separately exercised.

## 0.1.0 — 2026-09-27

Initial API debugger and CI/CD configurator implementation. Pipeline-plugin version: **0.1.0**.

### Added

- Shared HTTP/HTTPS request engine and VS Code request/response editor.

- Query parameters, headers, JSON/text/form bodies, multipart uploads, and binary request bodies.

- Basic, bearer, API-key, and OAuth 2 client-credentials authentication.

- Environment files, nested variables, UUID/timestamp values, VS Code SecretStorage references, and CLI process-environment references.

- GUI assertions, trusted time-limited pre/post scripts, asynchronous script assertions, response extraction, and sequential collection runs.

- Response inspection, binary downloads, host-only cookies, same-origin redirects, TLS CA/client certificates, cancellation, timeouts, and response-size limits.

- Native collection storage; partial Postman/Thunder Client imports, OpenAPI endpoint skeleton import, partial Postman export, and cURL templates with stated limitations.

- CLI collection execution with failure exit codes and JSON/JUnit reports that omit credential-bearing payloads and raw errors.

- GitHub Actions configuration for root-level npm, Python, and PHP projects: inspect, plan, apply, check, and rollback.

- Input-bound plans, conflict detection, preservation of unrelated workflows, repeatable configuration, and rollback protection for subsequent user edits.

- Explicit manual deployment configuration using environment names, commands, and secret references.

- Shared Codex / Claude Code plugin with a bundled `configure-pipeline` skill and dependency-free runtime; optional project-local skill installation for either host.

- Local demo API, sample collection, plugin packaging scripts, VSIX packaging, and a generated workflow for this toolkit.

- Upstream database-client and SFTP repository references with recorded revisions.

### Verification and limits

- Initial delivery passed 20 core/integration tests and one browser test; plugin and skill validators passed.

- Pipeline package: `dist/pipeline-configurator-0.1.0.zip`; it remains the current plugin package alongside extension 0.2.0.

- Full Thunder Client parity is not claimed. Remaining gaps include Digest/NTLM/AWS auth, interactive OAuth, proxies, WebSockets/gRPC, lossless migration of all scripts/tests/auth, domain-shared cookies, richer code generation, and API MCP tools.

- The API editor flattens imported folder hierarchies with a warning; the CLI supports inherited folder defaults.

- CI generation supports GitHub Actions and root-level projects, not general monorepo discovery or other providers. The built-in check does not execute hosted Actions jobs.

- Live Codex/Claude Code plugin loading, hosted CI runs, Marketplace publication, and production deployments were not part of local verification.

- Upstream database/SFTP extensions are separate projects and have not been modified or built here.
