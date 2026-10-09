# Development workflow

- Use `developement` for implementation, `test` for the committed test candidate, `deployment` for publication checks, and `main` only after successful publication.
- CI/CD policy is Python standard-library code in `cicd/`. Do not add GitHub Actions workflows or parallel release policy in JavaScript.
- Keep data adapters in `src/data` and `cicd/data`, business logic in `src/logic` and `cicd/logic`, and terminal/VS Code adapters in `src/interface` and `cicd/interface`.
- Core tests must not import VS Code or require a browser. The user replaced manual interface acceptance with the required AI UI/UX code-review gate.
- Run `python pipeline.py check` for development feedback. Commit changes, then `python pipeline.py test` for exact-commit evidence and AI review.
- Require evidence-backed UI/UX review of task flow, clarity/feedback, error recovery, destructive actions, keyboard access, accessibility and layout consistency. Never fabricate human UAT; ai-ux mode uses no human acceptance record.
- Publish only when requested, using `python pipeline.py publish`. Never manually advance `main` to bypass a failed or unavailable gate. Push development changes only to `developement`.
- When Marketplace is configured, upload only the retained review-approved VSIX through Entra-enabled vsce. Verify the public identity and payload before main promotion. Preserve uncertain-upload receipts; never blindly reupload or commit credentials.
- Required AI review must fail closed if unavailable, malformed, rejected, or finding high/critical issues. Do not replace it with a fake response outside isolated automated tests.
- Git authentication failures: retry the same authorized operation up to three total attempts with existing credentials. Inspect the remote after an uncertain push before retrying; never force-push.

- Before Marketplace upload, require the final credential scan and AI security review of the exact retained release archives. Do not request another manual approval; all mandatory gates must pass. Never include secret values in review reports.
