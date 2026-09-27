# Delivery roadmap — updated for 0.2.0

Version 0.2.0 adds precision-preserving JSON formatting/minification/validation, large-text and file comparisons through native VS Code diff snapshots, binary identity summaries, and Git commit/index/working-tree comparison with rename handling and independent path selection.

Implemented: shared API engine, VS Code editor, CLI reports, GitHub Actions configurator, and a dual-host Codex / Claude Code plugin with self-contained project-local skill installation. Automated API, CLI, pipeline and browser tests cover the implemented paths. The original milestones below remain a record of the intended broader scope; the root README is the current capability reference.

## 1. Workspace setup — complete

- Create the separate development-tools-kit folder and multi-root VS Code workspace.
- Clone both requested repositories and record their revisions.
- Define API debugger parity criteria and the CI/CD product architecture.

## 2. Technical evaluation — pending

- Build each upstream extension using its repository instructions and review dependencies/licenses before reuse.
- Compare Bruno and other candidate API clients against the full baseline checklist.
- Decide integration versus custom implementation using measured gaps, especially the VS Code UI and GUI assertions.
- Confirm target deployment environments and CI providers.

## 3. Implementation — working first release

- API debugger: shared execution core, extension editor, collection storage, environment handling, then CLI and advanced parity features.
- Pipeline configurator: discovery and GitHub Actions adapter, then VS Code UI and the two host-specific plugin packages with a shared skill.

## 4. Verification and release — local verification implemented; host and remote verification pending

- Run request/auth/import/export/CLI compatibility fixtures before claiming API feature parity.
- Verify pipeline output on representative repositories and verify idempotence.
- Package and test each extension/plugin in its actual host.
- Document installation, compatibility, limitations, upgrades, and recovery.

The implementation is locally testable and packaged as a VSIX. Complete Thunder Client parity, live agent-host loading, hosted CI execution, and production deployment are not claimed.
