# Delivery roadmap — 0.3.0

Implemented: API debugger and CLI, precision-preserving JSON tools, large text/file/Git comparisons, and Python CI/CD with Codex/Claude review adapters, unit/function/integration gates, human interface UAT, and controlled developement/test/deployment/main promotion. Product and pipeline now use explicit data/logic/interface layers. The Actions backend has been removed.

The database and SFTP repositories remain upstream references and optional independent checkouts. They are not bundled into the extension. Review their dependencies and licenses before integrating code.

Remaining product work includes complete Thunder Client compatibility (see the root README's explicit gaps), native plugin/extension host acceptance by the user, and target-specific external deployment once a hosting destination is chosen. The local pipeline is invoked through terminal or VS Code tasks; it is not a hosted runner or background scheduler.

Required release flow: commit on `developement`, run `test`, present the exact retained package for user UAT, record explicit acceptance, then run `publish` when requested. A successful fixture simulation or local check does not substitute for live AI review or human UAT.
