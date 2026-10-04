# Python pipeline configurator

Version 0.3.0 adds optional VS Code Marketplace publication with Microsoft Entra ID to the Python standard-library runtime. The VS Code extension, terminal wrapper, and Codex/Claude Code skill all invoke `pipeline.py`; no release policy is duplicated in JavaScript.

## Branches and commands

| Command | Behavior |
| --- | --- |
| `init` | Create missing local `developement`, `test`, and `deployment` branches from `main` |
| `status` | Print branch SHAs, reviewer, and evidence location |
| `check` | Run current architecture, unit, function, integration, and build checks; not release evidence |
| `test [--push]` | Pin committed development to test; run all gates and AI review in an isolated worktree |
| `accept-uat --commit SHA --reviewer NAME --note NOTES` | Record the user's actual interface acceptance against that test report |
| `marketplace-check` | Verify configured publisher access through local vsce and Entra without uploading |
| `publish` | Push deployment, rerun gates, upload and verify the approved VSIX when configured, then fast-forward main |

Use `python pipeline.py --root /path/to/project COMMAND`. `node cli.js pipeline COMMAND /path/to/project` is a thin terminal adapter; set `DEVKIT_PYTHON` when Python is not discoverable. The VS Code command palette exposes the same operations as tasks with terminal output and exit status.

## Configuration and architecture

`.devkit-pipeline.json` contains version 1, remote `origin`, reviewer `codex` or `claude`, timeout seconds, retained artifact paths, and nonempty argv-array groups for prepare/architecture/unit/function/integration/build. Runtime values are never shell-interpolated. Commands must be real project checks; the skill discovers or implements missing checks before declaring a project ready. Copy `pipeline.py` and `cicd/` plus a verified project-specific config when adopting this runtime elsewhere.

`cicd/data` owns Git, subprocesses, configuration and evidence I/O, and terminal reviewer adapters. `cicd/logic` owns policies and shared workflows. `cicd/interface` owns argument parsing and output. The JavaScript product mirrors the same layout in `src`. Core tests need no VS Code or browser. Architecture checks reject dependencies pointing from data into logic/interface or from logic into interface.

The default Codex review runs in a read-only sandbox with structured output and existing user authentication. Claude uses read-only tools and a supplied diff (maximum 1 MB). Neither automatically installs or authenticates an agent. Missing or malformed review, rejection, or high/critical findings fails the candidate.

## Evidence and recovery

Reports and artifact hashes are stored in `<git-common-dir>/devkit/`. Successful test artifacts are retained for human UAT. Evidence includes the exact candidate, main base, configuration digest, and each gate. UAT binds the report digest; changing source/configuration or rerunning test requires new UAT. Local HMAC detects edited evidence but is not protection against the same OS account. Direct Git pushes remain outside this local tool; use remote branch protections if organizational enforcement is required.

No force pushes occur. Conflicting branches require reconciliation on development and new testing. Missing UAT stops before deployment. Failed deployment gates leave deployment available for diagnosis and main unchanged. A failed main push leaves local main unchanged. If remote main advanced but a subsequent local update failed, inspect both refs and reconcile locally before continuing. Crashed locks require checking the recorded process before removing the lock. Never fabricate approval to recover from a failure.

Automated integration tests publish only into a temporary local bare repository using a fixture reviewer. Marketplace tests use local fixtures and never upload. Live AI CLI operation, user's UI acceptance, and remote authentication are separate prerequisites.

Optional `marketplace` configuration contains only `publisher`, `tenantId`, and a retained `.vsix` artifact path. Install locked dependencies with `npm ci` and sign in using `az login --tenant TENANT_ID --allow-no-subscriptions`; the account needs publisher Contributor or Owner permission. Credentials stay in the local Azure cache, outside Git. The upload uses `vsce publish --packagePath` with `--azure-credential`, removes any inherited `VSCE_PAT`, and never rebuilds or bumps the approved artifact. The public version and complete extension payload must match before main advances.

Signed receipts are saved before upload. An uncertain upload is never repeated automatically: rerunning publication verifies the existing attempt. If it remains absent, inspect the publisher portal and resolve the pending operation or bump the version and repeat testing/UAT. An existing version with conflicting content fails closed. Recovery after a successful remote main push requires passing deployment evidence and the matching public package, then updates local main. Marketplace upload and Git promotion are separate operations, so an upload can succeed while main remains unchanged. See the root README for setup and recovery details.
