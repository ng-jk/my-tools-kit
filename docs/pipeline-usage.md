# What the CI/CD tool does

The toolkit runs a Python CLI on this PC. The VS Code menu starts the same commands in a visible terminal task. No GitHub Actions or continuously running service is involved.

| Action | Result |
| --- | --- |
| Status | Shows local branch commits, reviewer, configuration and evidence location |
| Initialize branches | Creates missing developement/test/deployment branches from main |
| Check current changes | Runs architecture, unit, function, integration and build commands on the current files; no release approval is created |
| Test committed development | Sets test to the developement commit, builds/tests it in an isolated worktree and invokes Codex/Claude CLI review; optionally pushes test |
| Approve interface and finish release | Binds your acceptance to the exact tested commit and artifact hashes; automatically runs Publish when `autoPublishAfterUat` is true |
| Verify Marketplace access | Checks existing local Microsoft Entra authentication without uploading |
| Publish | Requires passing test evidence and acceptance; pushes deployment, reruns gates and AI review, uploads the retained VSIX when configured, verifies the public package, then fast-forwards main |

Open the target project folder first. That project must be a Git repository with main, origin, and `.devkit-pipeline.json` describing real test/build argv arrays. Initialize does **not** guess a project's tests or hosting destination. The included configure-pipeline agent skill discovers the project and writes its configuration; keep data, logic and interface separate so CLI tests can run without UI. This toolkit repository already has that configuration. An arbitrary folder will need it before menu commands work.

Set `devkit.pythonPath` in VS Code if Python is not on PATH. Install/authenticate the configured Codex or Claude Code CLI. Publishing needs Git push access and, for this toolkit, local Azure CLI login plus Marketplace publisher permission. The Marketplace stage is optional for other projects; this tool does not automatically deploy arbitrary websites or servers.

```sh
node cli.js pipeline status .
node cli.js pipeline check .
node cli.js pipeline test . --push
node cli.js pipeline accept-uat . --commit SHA --reviewer NAME --note "Actual acceptance checks"
# Retry publication if needed; UAT approval starts it automatically in this repo.
node cli.js pipeline publish .
```

A failed gate stops main promotion. Reports, approved packages, hashes and upload receipts live under `.git/devkit`. Source, configuration or test-report changes require new acceptance. Marketplace publication and Git promotion are separate operations: an upload can succeed while a later Git operation fails; retained receipts support verification without duplicate uploads. User interface acceptance remains the user's responsibility.

## Automatic final publication

This toolkit repository enables `"autoPublishAfterUat": true`. After passing `test`, use **CI/CD Pipeline → Approve interface and finish release**, or run `accept-uat` with your actual acceptance notes. That same run automatically checks deployment, publishes the retained approved VSIX through local vsce and Microsoft Entra ID, verifies the Marketplace package, and advances main. You do not need a separate publish command. Other projects default to false unless explicitly configured.

AI review, tests and human UAT remain required. An unavailable reviewer or failed gate stops release. If publication fails after approval, approval remains recorded and `publish` can retry using the retained package and upload receipts. Changing the candidate requires new test evidence and acceptance. Commit a new extension version before testing each Marketplace update; this workflow does not silently change a version after approval. Publishing updates the Marketplace listing; each VS Code installation must have extension auto-updates enabled to install updates automatically.
