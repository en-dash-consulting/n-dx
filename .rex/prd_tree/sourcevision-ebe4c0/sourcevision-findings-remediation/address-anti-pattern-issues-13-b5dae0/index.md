---
id: "b5dae0e0-cd90-4c48-8119-fd43bc3e5a84"
level: "task"
title: "Address anti-pattern issues (13 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-06T23:37:31.000Z"
completedAt: "2026-03-06T23:53:59.147Z"
acceptanceCriteria: []
description: "- rex-gateway.ts in hench re-exports 8 functions from rex with no version-lock or compatibility smoke test; breaking changes to rex's public API will only surface at runtime inside an agent loop, making them expensive to diagnose — add a gateway compatibility test\n- Call graph reports coupling=0 while cross-zone import table records 1 outgoing import to web-viewer — metric disagreement between analysis passes produces unreliable zone health scores and must be resolved before coupling data can be trusted for this zone.\n- MCP HTTP transport (the recommended integration path) has no E2E test coverage; the suite tests CLI process boundaries but not the HTTP session lifecycle, leaving the primary MCP surface unvalidated at the process boundary level.\n- No shared E2E fixture or helper module detected across 14 test files; duplicated process-spawn and environment setup logic increases maintenance burden and risks inconsistent test environments between files — extract common setup into a shared e2e-helpers module.\n- architecture-policy.test.js encodes zone IDs and tier boundaries statically; zone renames or structural changes will not automatically invalidate the policy assertions, creating a category of silent false-passes — tie policy checks to the live zone graph output rather than hardcoded identifiers.\n- CLI argument interfaces between orchestration scripts and domain package CLIs are untyped; any CLI signature change in rex, hench, or sourcevision is a silent breaking change with no compile-time or schema-level safety net — add contract tests or a shared CLI-args schema to make this boundary explicit\n- usage-cleanup-scheduler.ts depends on web-viewer (the UI application layer) from within a background service zone — scheduler lifecycle should be driven by an interface or event emitter, not a direct import of the viewer module, to prevent initialization-order coupling in tests and production startup\n- No shared design-token layer exists between viewer-static-assets and web-landing despite both being presentation zones in the same package; brand drift between landing page and viewer is undetectable at build time\n- elapsed-time.ts and task-audit.ts are reusable UI components but are grouped with build scripts and package assets in the web-build-infrastructure zone — they should be moved to the web-viewer zone or a dedicated components zone to collocate them with their consumers and avoid accidental coupling to build tooling\n- Absence of a dedicated test-support or shared-fixtures zone forces web-viewer tests to import from the low-cohesion web-unit zone (6 imports); introducing a scoped test-support module would break this dependency and allow web-unit to be dissolved or tightened\n- 2 production files (websocket.ts, ws-health-tracker.ts) do not justify an independent zone boundary; absorbing them into web-dashboard would eliminate the structural noise introduced by the test-inflated coupling metric\n- God function: cmdAnalyze in packages/rex/src/cli/commands/analyze.ts calls 44 unique functions — consider decomposing into smaller, focused functions\n- God function: runConfig in config.js calls 36 unique functions — consider decomposing into smaller, focused functions"
recommendationMeta: "[object Object]"
---

# Address anti-pattern issues (13 findings)

🔴 [completed]

## Summary

- rex-gateway.ts in hench re-exports 8 functions from rex with no version-lock or compatibility smoke test; breaking changes to rex's public API will only surface at runtime inside an agent loop, making them expensive to diagnose — add a gateway compatibility test
- Call graph reports coupling=0 while cross-zone import table records 1 outgoing import to web-viewer — metric disagreement between analysis passes produces unreliable zone health scores and must be resolved before coupling data can be trusted for this zone.
- MCP HTTP transport (the recommended integration path) has no E2E test coverage; the suite tests CLI process boundaries but not the HTTP session lifecycle, leaving the primary MCP surface unvalidated at the process boundary level.
- No shared E2E fixture or helper module detected across 14 test files; duplicated process-spawn and environment setup logic increases maintenance burden and risks inconsistent test environments between files — extract common setup into a shared e2e-helpers module.
- architecture-policy.test.js encodes zone IDs and tier boundaries statically; zone renames or structural changes will not automatically invalidate the policy assertions, creating a category of silent false-passes — tie policy checks to the live zone graph output rather than hardcoded identifiers.
- CLI argument interfaces between orchestration scripts and domain package CLIs are untyped; any CLI signature change in rex, hench, or sourcevision is a silent breaking change with no compile-time or schema-level safety net — add contract tests or a shared CLI-args schema to make this boundary explicit
- usage-cleanup-scheduler.ts depends on web-viewer (the UI application layer) from within a background service zone — scheduler lifecycle should be driven by an interface or event emitter, not a direct import of the viewer module, to prevent initialization-order coupling in tests and production startup
- No shared design-token layer exists between viewer-static-assets and web-landing despite both being presentation zones in the same package; brand drift between landing page and viewer is undetectable at build time
- elapsed-time.ts and task-audit.ts are reusable UI components but are grouped with build scripts and package assets in the web-build-infrastructure zone — they should be moved to the web-viewer zone or a dedicated components zone to collocate them with their consumers and avoid accidental coupling to build tooling
- Absence of a dedicated test-support or shared-fixtures zone forces web-viewer tests to import from the low-cohesion web-unit zone (6 imports); introducing a scoped test-support module would break this dependency and allow web-unit to be dissolved or tightened
- 2 production files (websocket.ts, ws-health-tracker.ts) do not justify an independent zone boundary; absorbing them into web-dashboard would eliminate the structural noise introduced by the test-inflated coupling metric
- God function: cmdAnalyze in packages/rex/src/cli/commands/analyze.ts calls 44 unique functions — consider decomposing into smaller, focused functions
- God function: runConfig in config.js calls 36 unique functions — consider decomposing into smaller, focused functions

## Info

- **Status:** completed
- **Priority:** critical
- **Level:** task
- **Started:** 2026-03-06T23:37:31.000Z
- **Completed:** 2026-03-06T23:53:59.147Z
- **Duration:** 16m
