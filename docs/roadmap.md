# Delivery roadmap — 0.5.0

Implemented: API debugger and CLI, precision-preserving JSON tools, large text/file/Git comparisons, and Python CI/CD with Codex/Claude review adapters, unit/function/integration gates, human interface UAT, and controlled developement/test/deployment/main promotion. Product and pipeline now use explicit data/logic/interface layers. The Actions backend has been removed.

SFTP is integrated from the supplied upstream source, with a toolkit sidebar, remote explorer, CLI and shared layers. See sftp.md for the complete inventory and verification limits. Database Client remains an unbundled reference.

Marketplace publication now uses local vsce with Microsoft Entra ID, uploads the exact UAT-approved VSIX, verifies the public payload, and advances main only after success. Uncertain uploads retain a receipt and are verified without duplicate upload attempts.

Remaining product work includes complete Thunder Client compatibility (see the root README's explicit gaps), native plugin/extension host acceptance by the user, and deployment to other hosting targets if requested. The local pipeline is invoked through terminal or VS Code tasks; it is not a hosted runner or background scheduler.

Required release flow: commit on `developement`, run `test`, present the exact retained package for user UAT, record explicit acceptance, then run `publish` when requested. A successful fixture simulation or local check does not substitute for live AI review or human UAT.
