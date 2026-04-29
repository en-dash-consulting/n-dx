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

## Subtask: Add gateway compatibility test for hench rex-gateway

**ID:** `e578c79d-60e8-453f-be22-5f422774c88d`
**Status:** completed
**Priority:** high

rex-gateway.ts in hench re-exports 8+ functions from rex with no version-lock or compatibility smoke test. Add a test that verifies all re-exported functions exist and are callable, so rex API changes are caught at test time rather than at runtime inside agent loops.

**Acceptance Criteria**

- Gateway compatibility test exists in hench test suite
- Test verifies all re-exported functions are defined and callable
- Test fails if any re-exported function is removed from rex public API

---

## Subtask: Extract shared E2E test helpers module

**ID:** `3519e7a3-883a-4e0c-82f3-6decde6046cf`
**Status:** completed
**Priority:** high

No shared E2E fixture or helper module across 14 test files. Extract common process-spawn, environment setup, and cleanup logic into a shared e2e-helpers module to reduce duplication and ensure consistent test environments.

**Acceptance Criteria**

- Shared e2e-helpers module exists in tests/e2e/
- Common spawn/setup patterns extracted from existing tests
- At least 3 existing test files updated to use shared helpers

---

## Subtask: Decompose cmdAnalyze god function

**ID:** `49cd3604-e0eb-4fe3-88ac-ea0e020c0a0f`
**Status:** completed
**Priority:** high

cmdAnalyze in packages/rex/src/cli/commands/analyze.ts calls 44 unique functions. Decompose into smaller, focused phases (config resolution, scanning, proposal processing, acceptance).

**Acceptance Criteria**

- cmdAnalyze broken into named sub-functions
- Each extracted function has a clear single responsibility
- Existing tests continue to pass

---

## Subtask: Decompose runConfig god function

**ID:** `67ed05f2-ab56-42c5-bb1e-7148faf3cd99`
**Status:** completed
**Priority:** high

runConfig in config.js calls 36 unique functions. Decompose into smaller, focused functions for each config section handler.

**Acceptance Criteria**

- runConfig broken into named sub-functions
- Each section handler is its own function
- Existing tests continue to pass

---

## Subtask: Fix usage-cleanup-scheduler web-viewer coupling

**ID:** `650803e7-c8c3-42c4-9363-9d1423d9a7a7`
**Status:** completed
**Priority:** medium

usage-cleanup-scheduler.ts depends on web-viewer zone. Scheduler lifecycle should use interface/event emitter, not direct import of viewer module, to prevent initialization-order coupling.

**Acceptance Criteria**

- No direct imports from web-viewer zone in scheduler
- Scheduler uses injected interfaces or events
- Tests pass without viewer initialization

---

## Subtask: Move elapsed-time.ts and task-audit.ts to viewer zone

**ID:** `61de5525-b96d-44b0-8628-60dfe743a8f2`
**Status:** completed
**Priority:** medium

elapsed-time.ts and task-audit.ts are UI components grouped with build scripts in web-build-infrastructure zone. Move to viewer zone where their consumers live.

**Acceptance Criteria**

- UI components colocated with viewer consumers
- All imports updated
- Build and tests pass

---

## Subtask: Add CLI argument contract tests

**ID:** `05d92652-08b9-4610-9f27-48623d61c7a0`
**Status:** completed
**Priority:** medium

CLI argument interfaces between orchestration scripts and domain package CLIs are untyped. Add contract tests that verify CLI help output matches expected argument signatures, catching silent breaking changes.

**Acceptance Criteria**

- Contract test validates rex, hench, sourcevision CLI signatures
- Test breaks when CLI args change without updating contract
- Covers at least the top-level commands

---

## Subtask: Absorb websocket zone into web-dashboard

**ID:** `7ebfc2ad-2694-4288-8f31-bc8e874ee49d`
**Status:** completed
**Priority:** low

websocket.ts and ws-health-tracker.ts don't justify an independent zone. Absorb into web-dashboard to eliminate structural noise from test-inflated coupling metric.

**Acceptance Criteria**

- websocket files are part of web-dashboard zone
- No standalone websocket zone in analysis output
- Build and tests pass

---

## Subtask: Tie architecture policy test to live zone graph

**ID:** `26a806b2-1b3a-4487-aea9-b791962ad924`
**Status:** completed
**Priority:** medium

architecture-policy.test.js encodes file paths statically. Zone renames or structural changes won't invalidate assertions. Add validation that the ALLOWED files still exist, preventing silent false-passes from stale entries.

**Acceptance Criteria**

- Policy test validates ALLOWED entries still exist on disk
- Stale ALLOWED entries cause test failure
- Test documents why each exception exists

---
