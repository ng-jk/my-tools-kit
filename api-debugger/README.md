# API Debugger

## Product objective

Build a local-first VS Code API debugging extension with a shared CLI runner, targeting all applicable Thunder Client functions, including paid functionality. Version 0.3.0 separates I/O in `../src/data/`, reusable API/JSON/comparison behavior in `../src/logic/`, and terminal/VS Code adapters in `../src/interface/`. Root entry points and `lib/` modules preserve compatibility. Unit/function/integration checks run through the Python pipeline without the graphical interface; the user performs interface acceptance. This is not a claim of completed parity; the root README documents supported functionality and limits.

## Existing alternative to evaluate

[Bruno](https://github.com/usebruno/bruno) is a candidate for file-based API collections and automated testing. Its [agent documentation](https://docs.usebruno.com/agents/use-cases) describes generating collections, scripting tests, and CI/CD workflows. Evaluate it before deciding whether to integrate its runner or implement our own. A standalone client does not automatically satisfy the requested VS Code experience, and complete feature parity remains unverified.

## Acceptance checklist

This remains the full-product acceptance checklist. Core HTTP, auth, bodies, variables, scripts, assertions, collection runs and reports have automated coverage. Several broad compatibility requirements remain partial. Expand this checklist against the exact Thunder Client version selected for comparison before declaring parity.

| Area | Required behavior | Evidence required |
| --- | --- | --- |
| Request editor | HTTP methods, query parameters, headers, JSON/text/XML, forms, multipart files, binary bodies | Fixture server checks exact transmitted bytes |
| Authentication | Inventory and reproduce the baseline's supported auth methods, inheritance, and token refresh | Per-method interoperability tests without stored plaintext secrets |
| Response inspection | Status, timing, size, headers, formatted/raw body, search, downloads | JSON, text, binary, error, and large-response fixtures |
| Organization | Collections, folders, history, duplication, search, ordering | Persistence and migration tests |
| Variables | Environments, scopes, precedence, dynamic values, response extraction, filters | Scope and substitution fixtures |
| Testing | GUI assertions plus pre/post scripts at request, folder, and collection levels | Pass/fail fixtures and script execution order tests |
| State and transport | Cookies, redirects, proxy configuration, certificates, timeouts, cancellation | Local transport fixtures and failure handling |
| Data portability | Baseline-supported import/export formats, cURL, generated code snippets | Round-trip tests and explicit warnings for unsupported constructs |
| Collaboration | Local files, Git-friendly changes, portable collections, excluded secrets | Two-checkout round-trip with no credential leakage |
| CLI and CI | Same requests/tests as extension, collection runs, reports, reliable exit codes | Identical GUI/CLI results and failing CI fixture |
| AI integration | Discoverable tools for creating and running authorized requests | Agent integration tests and redacted outputs |
| Other protocols | Inventory baseline protocol support and implement any additional required protocols | Protocol-specific parity fixtures |

## Proposed architecture

- Shared request, environment, assertion, and serialization libraries.
- VS Code extension host for execution and secret storage; webview for the editor and results.
- CLI using the same core for CI runs and machine-readable reports.
- Versioned collection format and explicit adapters for imported data.
- Repository scripts are executable content: run only in a trusted workspace with bounded execution and cancellation. Keep credentials out of collections and logs.

## Baseline sources

Reviewed on 2026-09-27:

- [Thunder Client feature overview](https://docs.thunderclient.com/get-started)
- [Thunder Client scripting](https://docs.thunderclient.com/scripting)
- [Thunder Client CLI](https://docs.thunderclient.com/cli)
- [Code snippet generation](https://docs.thunderclient.com/features/code-snippet)

These document collections, environments, GUI assertions, scripts, cookies, imports, Git collaboration, CLI reports, and AI integration. The checklist also includes engineering requirements that need separate baseline verification.
