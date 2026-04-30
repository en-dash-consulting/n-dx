---
id: "7db09c37-23c0-4d64-90ed-bc90ee3c595d"
level: "task"
title: "Address anti-pattern issues (11 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-07T02:08:13.639Z"
completedAt: "2026-03-07T02:16:05.730Z"
acceptanceCriteria: []
description: "- E2E tests that spawn CLI subprocesses share no documented workspace isolation strategy; if tests run concurrently and both write to .rex/prd.json or .sourcevision/, results are non-deterministic. No test uses a dedicated temp directory per test file.\n- `_testHelpers` is exported through the production module surface of crash-detector.ts, bundling internal implementation details (storage keys, private functions) into the public API. Test-only exports should use a separate test-support file or conditional barrel to avoid polluting the production interface.\n- hench-callgraph-analysis.mjs produces HENCH_CALLGRAPH_FINDINGS.md but has no fail-fast guard that detects missing or stale input artifacts; silent success on a cold checkout produces a misleading (empty or stale) report with no error signal.\n- The rex-gateway is imported directly by scattered consumer files across 160 files with no internal hench interface layer. When the rex gateway API changes, every call site must be updated individually with no intermediate abstraction to narrow the scope of change. An internal adapter or facade within hench that wraps the gateway would contain the blast radius.\n- The orchestration tier's architectural boundary (no direct package imports) is enforced solely by developer convention — no ESLint rule, TypeScript path mapping, or CI check prevents a direct `import` from cli.js into a domain package. A single accidental import would collapse the tier silently.\n- claude-integration.js is a service file at the monorepo root that bypasses the gateway pattern entirely. Any cross-package imports it makes are invisible to gateway audits and import-graph coupling scores, creating an unmonitored coupling surface outside all four tiers of the dependency hierarchy.\n- Proposal, ProposalFeature, and ProposalTask types are defined locally in analyze-panel.ts rather than imported from a shared rex schema or gateway. The local copy will silently diverge from the API response shape if the server-side PRD proposal format changes.\n- `useState(() => { loadPending(); })` in analyze-panel.ts misuses the useState initializer to trigger an async network call. This is not the intended use of the initializer (which sets initial synchronous state) and bypasses the standard effect lifecycle, making cleanup and double-invocation behavior undefined.\n- Web viewer unit tests (graph-interaction.test.ts, graph-zoom.test.ts) are excluded from packages/web per-package test coverage because they reside outside the package boundary in this zone; per-package coverage reports for the web package silently undercount viewer UI test coverage.\n- Zone contains files from two physically distinct roots (packages/web/tests/unit/viewer/ and tests/) with unrelated purposes; zone name 'viewer-gateway-tests' implies viewer scope only, actively misleading contributors about the gateway scripts' monorepo-wide scope. Should be split into two zones aligned to physical location and concern.\n- God function: <module> in packages/web/src/landing/landing.ts calls 42 unique functions — consider decomposing into smaller, focused functions"
recommendationMeta: "[object Object]"
---

# Address anti-pattern issues (11 findings)

🟠 [completed]

## Summary

- E2E tests that spawn CLI subprocesses share no documented workspace isolation strategy; if tests run concurrently and both write to .rex/prd.json or .sourcevision/, results are non-deterministic. No test uses a dedicated temp directory per test file.
- `_testHelpers` is exported through the production module surface of crash-detector.ts, bundling internal implementation details (storage keys, private functions) into the public API. Test-only exports should use a separate test-support file or conditional barrel to avoid polluting the production interface.
- hench-callgraph-analysis.mjs produces HENCH_CALLGRAPH_FINDINGS.md but has no fail-fast guard that detects missing or stale input artifacts; silent success on a cold checkout produces a misleading (empty or stale) report with no error signal.
- The rex-gateway is imported directly by scattered consumer files across 160 files with no internal hench interface layer. When the rex gateway API changes, every call site must be updated individually with no intermediate abstraction to narrow the scope of change. An internal adapter or facade within hench that wraps the gateway would contain the blast radius.
- The orchestration tier's architectural boundary (no direct package imports) is enforced solely by developer convention — no ESLint rule, TypeScript path mapping, or CI check prevents a direct `import` from cli.js into a domain package. A single accidental import would collapse the tier silently.
- claude-integration.js is a service file at the monorepo root that bypasses the gateway pattern entirely. Any cross-package imports it makes are invisible to gateway audits and import-graph coupling scores, creating an unmonitored coupling surface outside all four tiers of the dependency hierarchy.
- Proposal, ProposalFeature, and ProposalTask types are defined locally in analyze-panel.ts rather than imported from a shared rex schema or gateway. The local copy will silently diverge from the API response shape if the server-side PRD proposal format changes.
- `useState(() => { loadPending(); })` in analyze-panel.ts misuses the useState initializer to trigger an async network call. This is not the intended use of the initializer (which sets initial synchronous state) and bypasses the standard effect lifecycle, making cleanup and double-invocation behavior undefined.
- Web viewer unit tests (graph-interaction.test.ts, graph-zoom.test.ts) are excluded from packages/web per-package test coverage because they reside outside the package boundary in this zone; per-package coverage reports for the web package silently undercount viewer UI test coverage.
- Zone contains files from two physically distinct roots (packages/web/tests/unit/viewer/ and tests/) with unrelated purposes; zone name 'viewer-gateway-tests' implies viewer scope only, actively misleading contributors about the gateway scripts' monorepo-wide scope. Should be split into two zones aligned to physical location and concern.
- God function: <module> in packages/web/src/landing/landing.ts calls 42 unique functions — consider decomposing into smaller, focused functions

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-07T02:08:13.639Z
- **Completed:** 2026-03-07T02:16:05.730Z
- **Duration:** 7m
