---
name: configure-pipeline
description: Configure and operate Python CLI CI/CD with shared data/logic/interface layers, AI review, unit/function/integration tests, human interface UAT, and developement/test/deployment/main promotion. Use for pipeline setup, repair, testing, publishing, or project-local Codex and Claude Code integration without GitHub Actions.
---

# Configure the shared Python pipeline

Use Python 3.11+ and Git. Resolve `scripts/runtime/pipeline.py` relative to this skill directory when using the bundled plugin. The repository's `pipeline.py` is preferred when present. Pipeline implementation uses only the Python standard library; project checks may invoke their native language CLIs.

Inspect repository instructions, branches, origin, package manifests, test suites, and deployment requirements. Preserve user changes. Use exact branch names `developement`, `test`, `deployment`, and `main`. Do not generate GitHub Actions or change global agent permissions, credentials, or settings.

For a repository without the runtime, copy bundled `pipeline.py` and `cicd/` to its root only when those paths are absent; reconcile existing files instead of overwriting them. Create `.devkit-pipeline.json` version 1, remote `origin`, reviewer `codex` (or the user's installed `claude` CLI), timeout in seconds, optional relative `artifacts` paths, and `commands` groups `prepare`, `architecture`, `unit`, `function`, `integration`, and `build`. Each group is a nonempty list of argv arrays. Use `{python}` for the current interpreter. Never use shell strings, placeholder successful commands, empty test discovery, or fake review responses as release gates. Determine actual commands from repository evidence, and implement missing tests before claiming readiness. Keep dependencies pinned through the project's lockfile.

All features must be callable from both a terminal and the product UI through the same business logic. Keep persistence, HTTP, subprocesses, and Git in data adapters; reusable behavior and policies in logic; argument parsing and UI handling in interfaces. Unit and function tests exercise data/logic directly; CLI integration tests may exercise terminal adapters. Browser/VS Code acceptance belongs to the user and is not an automatic release gate.

Run `python pipeline.py --root <project> init`, then `check` for development feedback. Check does not create release evidence. Commit to `developement`, run `test` (optionally `--push` for the test branch), and inspect the JSON report. It must include successful architecture, unit, function, integration, build, and actual AI review gates for the exact SHA. Any missing CLI, auth failure, malformed review, rejected review, or high/critical finding blocks publication. Fix issues and retest; never weaken the gates to obtain a pass.

Present the tested commit and retained artifact path for the user's interface UAT. Never invent acceptance. Run `accept-uat --commit <sha> --reviewer <human> --note <actual acceptance notes>` only after the user explicitly accepts that commit. Retesting invalidates the old acceptance record.

Only when the user requests publication, run `publish`. It pushes the tested commit to `deployment`, reruns gates in an isolated checkout, and fast-forwards `main` only on success. Never manually push main around a failure. With no hosting target configured, publication means repository branch promotion and package creation, not uploading to a cloud service or extension marketplace. Report that distinction.

Reports and HMAC evidence are local under the Git common directory's `devkit/` folder. They detect accidental edits, not malicious activity by the same operating-system user. Another machine must test and record human UAT again. Preserve results and up to three authentication attempts with existing credentials; inspect a remote ref after an uncertain push before retrying.

For requested project-local integration, copy this skill and its `scripts/runtime` into `.agents/skills/configure-pipeline/` for Codex or `.claude/skills/configure-pipeline/` for Claude Code, preserving existing customizations. Do not change global permissions or automatically install third-party plugins. Explain that a fresh agent session may be needed to discover new skills.
