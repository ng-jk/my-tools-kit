# Pipeline Configurator

## Product objective

A CI/CD configuration product exposed through a VS Code extension, a Claude Code plugin, and a Codex plugin. Both agent integrations ship a reusable skill that inspects a repository and configures the project's pipeline and project-local agent integration.

Status: version 0.1.0 implemented. The shared backend is `../lib/pipeline.js`; `../pipeline-cli.js` exposes it to automation; the root VS Code extension presents plans; `../plugins/pipeline-configurator` contains both host manifests and a bundled skill/runtime. No deployment or global plugin installation has been performed.

## Shared workflow

1. Inspect the repository: instructions, languages, manifests, lockfiles, test/build commands, existing workflows, containers, and deployment configuration.
2. Produce an evidence-backed configuration plan. Distinguish observed commands from guesses and request only essential missing deployment details.
3. Render a preview of proposed files and a diff against existing configuration.
4. Apply authorized project-local edits, preserving custom workflow jobs and user changes.
5. Validate workflow syntax and run the project's relevant checks. Report checks that cannot run locally.
6. Record configured files, prerequisites, and results. Re-running with the same inputs must produce no changes.

## Components

| Component | Responsibility |
| --- | --- |
| Core library | Repository discovery, normalized pipeline model, provider adapters, diff generation, validation |
| CLI | Stable inspect/plan/apply/check interface with structured output for agents |
| VS Code extension | Setup flow, repository findings, editable pipeline options, preview, diagnostics |
| Claude Code plugin | Host-specific manifest and packaged skill calling the shared workflow |
| Codex plugin | Host-specific manifest and packaged skill calling the same workflow |
| Shared skill source | Repeatable discovery, configuration, verification, and recovery instructions |

Implemented provider: GitHub Actions. npm, Python and PHP root manifests are supported. The generated workflow is a JSON-form YAML document in a dedicated managed file; unrelated workflows are preserved. Existing managed edits cause a conflict rather than a destructive merge. GitLab CI, Azure Pipelines, Jenkins, monorepo discovery, and specialized runtime adapters remain future work.

## Agent self-configuration requirements

The skill should configure the target project's integration, not rewrite global agent policy or grant itself permissions. It should discover supported host capabilities, create project-local configuration from validated templates, reference secret names instead of values, and verify that the host can discover the integration.

Use the currently documented packaging format for each host at implementation time. Maintain a shared skill source and generate host packages so fixes stay consistent. Do not assume Claude Code and Codex plugin manifests are interchangeable.

## Pipeline requirements

- Infer package manager from lockfiles; flag conflicting lockfiles.
- Separate lint, test, build, package, and deploy stages; preserve required ordering and artifacts.
- Use minimal job permissions and no production secrets in untrusted pull-request jobs.
- Pin tool versions and reviewed action revisions; document upgrade procedures.
- Support caches, matrices, concurrency, environments, secret references, and rollback instructions where relevant.
- Make deployment conditional on an explicitly configured target and the user's existing authorization.
- Avoid overwriting existing workflows; merge supported structures or return a precise conflict.
- Keep an edit manifest and restore only files changed by the configurator when rolling back.

## Acceptance criteria

1. Node.js, Python, and PHP fixture projects yield runnable CI with their actual test/build commands.
2. Existing custom jobs survive configuration and a second run yields no diff.
3. Missing commands, credentials, or deployment targets produce actionable findings.
4. VS Code, Claude Code, and Codex produce equivalent configuration from the same inputs.
5. Host discovery, plugin packaging, skill invocation, workflow validation, and failure recovery are tested before release.
