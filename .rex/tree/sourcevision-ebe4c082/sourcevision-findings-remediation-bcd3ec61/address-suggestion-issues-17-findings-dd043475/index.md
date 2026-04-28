---
id: "dd043475-16b3-4419-8aec-52cb76f992c7"
level: "task"
title: "Address suggestion issues (17 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-07T00:01:11.668Z"
completedAt: "2026-03-07T00:06:47.952Z"
description: "- Run intra-package call-graph analysis on hench to detect any emerging circular call patterns between its internal subdirectories (agent/, prd/, tools/) before they compound — the rex circular call pattern (239+100 calls) was only found via call-graph analysis, not zone metrics, and hench's 2838 internal calls make it the most likely next site for a hidden cycle.\n- Add a dependency-cruiser or similar import-boundary rule to CI that enforces the gateway pattern: any cross-package import that does not pass through the designated gateway module should fail the build. This converts a trust-based convention into a machine-enforced constraint.\n- All micro-zones (< 5 production files) in the web package lack facade index modules, meaning their zone boundaries exist only in the zone detection metadata and are invisible to the TypeScript compiler — mandate an 'index.ts' barrel for every zone with 2+ production files to make zone membership compiler-visible and reduce the risk of zone boundaries eroding silently.\n- Establish a documented testing convention for the utility+hook pattern: every hook wrapper (use-*.ts) should have a corresponding hook test file alongside the utility test — currently dom-performance-monitoring applies the production pattern but not the test pattern, and without a written convention future hooks will follow the same incomplete template.\n- Introduce a project-wide lint rule enforcing that files in 'src/server/' cannot import from 'src/viewer/' — the two known violations (task-usage-tracking, websocket boundary-check) both evade detection because the no-upward-import convention is undocumented and unenforced; a lint rule would surface new violations at PR time rather than zone-enrichment time.\n- Reconcile the two analysis passes (call-graph and cross-zone import table) that report contradictory coupling values for the dom zone — add a CI step that asserts zone IDs are consistent across both passes and flags any zone that appears in one pass but not the other, before this class of metric disagreement spreads to other zones.\n- 5 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:unit-core, packages-rex:unit-cli, websocket-infrastructure, packages-sourcevision:analyzers-3, packages-rex:unit — mandatory refactoring recommended before further development\n- Split the web-build-infrastructure zone into two groups: (1) build tooling (build.js, dev.js, package.json, images, markdown) and (2) reusable UI components (elapsed-time.ts, task-audit.ts) — these two groups have different change drivers, different consumers, and different lifecycle concerns that should not share a zone boundary.\n- Add use-dom-performance-monitor.test.ts to cover the hook's lifecycle: verify the monitor is started on mount, stopped on unmount, and that ref changes trigger re-subscription — the utility has test coverage but the hook wrapper that most consumers interact with does not.\n- Document the execution log rotation policy (max file size, max file count, rotation trigger) in .rex/config.json or a companion README to prevent unbounded log accumulation and clarify when execution-log.1.jsonl vs execution-log.jsonl is the authoritative current log.\n- Neither source file in this zone exports through a shared index — introduce a thin 'index.ts' barrel that re-exports the public surfaces of both services, giving the zone an explicit boundary and preventing consumers from coupling to internal file paths.\n- websocket-infrastructure breaches both cohesion (<0.5) and coupling (>0.5) thresholds simultaneously — this double breach qualifies it as the highest-priority structural risk in the web package; dissolve the zone by absorbing websocket.ts and ws-health-tracker.ts into web-dashboard and relocating boundary-check.test.ts to the integration test suite.\n- Zone \"WebSocket Infrastructure\" (websocket-infrastructure) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention\n- Zone \"Unit Core\" (packages-rex:unit-core) has catastrophic risk (score: 0.83, cohesion: 0.17, coupling: 0.83) — requires immediate architectural intervention\n- Zone \"Unit Cli\" (packages-rex:unit-cli) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention\n- Zone \"Analyzers 3\" (packages-sourcevision:analyzers-3) has critical risk (score: 0.69, cohesion: 0.31, coupling: 0.69) — requires refactoring before new feature development\n- Zone \"Unit\" (packages-rex:unit) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development"
recommendationMeta: "[object Object]"
---

## Subtask: Add gateway pattern import boundary enforcement to CI

**ID:** `c8c80a8e-d0a8-495f-992e-161d639bb94e`
**Status:** completed
**Priority:** high

Add an eslint rule or custom CI check that enforces the gateway pattern: any cross-package runtime import that does not pass through the designated gateway module should fail the build. Also add a rule preventing src/server/ from importing src/viewer/ in the web package. Covers findings: gateway pattern CI enforcement, server/viewer import boundary.

**Acceptance Criteria**

- CI step validates that cross-package imports only go through gateway modules
- ESLint or custom rule prevents packages/web/src/server/ from importing packages/web/src/viewer/
- Existing code passes the new rules (no false positives)

---

## Subtask: Add use-dom-performance-monitor hook test and document utility+hook testing convention

**ID:** `46cc778b-1b8d-4966-8448-10efefeae0d7`
**Status:** completed
**Priority:** high

Write use-dom-performance-monitor.test.ts covering hook lifecycle: monitor started on mount, stopped on unmount, ref changes trigger re-subscription. Document the testing convention for utility+hook pattern in PACKAGE_GUIDELINES.md.

**Acceptance Criteria**

- use-dom-performance-monitor.test.ts exists with mount/unmount/ref-change tests
- PACKAGE_GUIDELINES.md documents the utility+hook testing convention
- Tests pass in CI

---

## Subtask: Add barrel index.ts for web micro-zones and dom-performance-monitoring zone

**ID:** `d66020ad-acb7-4ceb-a785-26ebee6a8913`
**Status:** completed
**Priority:** medium

Add index.ts barrel exports for web micro-zones with 2+ production files that lack them. Specifically add dom-performance-monitor exports to the performance/index.ts barrel. Covers findings about micro-zone barrels and zone boundary visibility.

**Acceptance Criteria**

- performance/index.ts re-exports dom-performance-monitor public surface
- All micro-zones with 2+ production files have index.ts barrels
- No circular imports introduced

---

## Subtask: Document execution log rotation policy

**ID:** `37c6e809-baad-44af-8e38-293d0c6089fe`
**Status:** completed
**Priority:** medium

Document the execution log rotation policy (max file size, max file count, rotation trigger) in .rex/config.json schema or a companion README. Clarify when execution-log.1.jsonl vs execution-log.jsonl is authoritative.

**Acceptance Criteria**

- Log rotation policy is documented with max size, max count, and trigger
- Documentation clarifies which log file is the current/authoritative one

---

## Subtask: Address high-risk zone metrics (5 zones exceeding thresholds)

**ID:** `71a5969e-be82-4b38-95c6-f101ebb5c84f`
**Status:** completed
**Priority:** high

Address the 5 zones exceeding architectural risk thresholds: packages-rex:unit-core (0.83 risk), packages-rex:unit-cli (0.75 risk), websocket-infrastructure (0.75 risk), packages-sourcevision:analyzers-3 (0.69 risk), packages-rex:unit (0.67 risk). Dissolve websocket-infrastructure by absorbing into web-dashboard. Split web-build-infrastructure into build tooling and UI components. Investigate and refactor rex zones for better cohesion/coupling.

**Acceptance Criteria**

- websocket-infrastructure zone dissolved into web-dashboard
- web-build-infrastructure split into build tooling and UI components
- All 5 high-risk zones show improved metrics or have documented justification for current structure

---

## Subtask: Hench call-graph analysis and analysis pass reconciliation

**ID:** `e69233dd-81d0-48da-a498-c5123a36240b`
**Status:** completed
**Priority:** medium

Run intra-package call-graph analysis on hench to detect circular call patterns between agent/, prd/, tools/. Reconcile analysis passes that report contradictory coupling values for the dom zone. Add CI step asserting zone IDs are consistent across both passes.

**Acceptance Criteria**

- Hench call-graph analysis completed with findings documented
- Zone ID consistency check added to CI pipeline
- Any circular patterns identified are documented with remediation plan

---
