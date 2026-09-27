---
name: configure-pipeline
description: Inspect an npm, Python, or PHP project and configure GitHub Actions CI/CD and project-local Codex or Claude Code skills using Development Tools Kit. Use for pipeline setup, repair, or agent integration in a specific repository.
---

Use the bundled runtime at `scripts/runtime/pipeline-cli.js`, resolved relative to this skill directory. It needs Node.js 20 or newer and has no package dependencies. Quote filesystem paths when invoking it.

Read the target repository's instructions and run `node <runtime> inspect <project>`. The runtime supports manifests at the selected project root; select a package directory explicitly for monorepos. Inspection never executes project scripts.

Generate a plan with `node <runtime> plan <project> --agents codex,claude --out <plan.json>`, selecting only the hosts requested by the user. Omit `--agents` for pipeline-only changes. Review the file changes and findings. Unsupported package managers, ambiguous lockfiles, and modified managed files are conflicts; preserve those files and resolve the actual mismatch instead of deleting them.

The optional `.devkit-pipeline.json` accepts `nodeVersion` (numeric string), `pythonTest` (verified command), and `deploy` with `environment`, `command`, and a `secrets` mapping of environment-variable names to GitHub secret names. Determine commands from repository evidence. Python and PHP use Ubuntu 24.04 runner tooling; specialized runtime requirements need a custom workflow. Deployment commands run on a fresh runner and must perform their own installation/build or artifact retrieval. Deployment is manual and limited to the default branch. Ask for missing deployment target information only if it is needed for the requested work.

Apply authorized changes with `node <runtime> apply <project> --plan <plan.json>`. A saved plan is bound to its project and current inputs; stale or modified plans must be regenerated. Applying also installs the selected project-local skills with their own runtime. It never changes global permissions or agent policy.

Run `node <runtime> check <project>` and the relevant actual project checks within the user's authorization. The built-in check validates generated configuration consistency; it does not execute GitHub Actions. Retain `.devkit/pipeline-state.json` locally for ownership tracking and rollback. Exclude `.devkit/` from version control when appropriate; commit the generated workflow and project-local skills.

Report files changed, checks performed, and remaining external setup such as GitHub environment protection or secret provisioning. Use `node <runtime> rollback <project>` only when reverting these managed changes is requested; rollback refuses to overwrite subsequent user edits.
