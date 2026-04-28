---
id: "491e1097-3e0a-4900-8cf3-fa36c42cafae"
level: "task"
title: "Address observation issues (10 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-07T02:17:02.814Z"
completedAt: "2026-03-07T02:32:43.844Z"
description: "- High coupling (0.71) — 3 imports target \"web-dashboard\"\n- Cohesion of 0.29 is below the warning threshold — the two files in this zone (hook and detector) are more coupled to web-dashboard than to each other, suggesting a zone boundary mismatch.\n- Coupling of 0.71 exceeds the warning threshold; the crash recovery subsystem has high external dependency, which reduces its reusability and increases change risk.\n- use-crash-recovery.ts lacks a unit test; given that crash recovery is a reliability-critical code path, this gap should be addressed.\n- Bidirectional coupling: \"web-dashboard\" ↔ \"web-package-scaffold\" (3+9 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects\n- 9 entry points — wide API surface, consider consolidating exports\n- Bidirectional imports with both 'crash' and 'panel' zones create implicit circular dependencies at the zone level; these relationships should be reviewed to ensure directional ownership is clear.\n- analyze-panel.ts and proposal-editor.ts lack unit tests while the simpler smart-add-input and batch-import-panel components are tested — the more complex components should be prioritized for test coverage.\n- Viewer UI files are co-classified with build scripts due to shared import edges; zone pinning for elapsed-time.ts, route-state.ts, task-audit.ts, use-tick.ts, lazy-children.ts, and listener-lifecycle.ts is recommended to correct classification."
recommendationMeta: "[object Object]"
---

## Subtask: Pin crash-recovery and web-package-scaffold UI files to correct zones

**ID:** `1b7f3f55-8aae-4054-8d4e-e8be59016404`
**Status:** completed
**Priority:** high

Add zone pins in .n-dx.json for: crash-detector.ts, use-crash-recovery.ts, crash-recovery-banner.ts, crash-detector-test-support.ts, crash-detector.test.ts → web-dashboard; route-state.ts, use-tick.ts, lazy-children.ts, listener-lifecycle.ts → web-dashboard. This resolves findings 1-3, 5, 8, 10.

---

## Subtask: Add unit test for use-crash-recovery.ts hook

**ID:** `da1a0642-c5f1-4842-ad6b-485f273f8a5c`
**Status:** completed
**Priority:** high

Write unit tests for the useCrashRecovery Preact hook covering: initial detection, state saving on view changes, dismiss/restore actions, disabled mode, and crash loop detection. Finding 4.

---

## Subtask: Add unit tests for analyze-panel.ts and proposal-editor.ts

**ID:** `9fb96dfc-a660-444f-ae70-0c992fe3b13d`
**Status:** completed
**Priority:** high

Write unit tests for the two complex PRD analysis UI components. Finding 9.

---

## Subtask: Document fan-in hotspot and review web-dashboard entry points

**ID:** `6e6dae9d-6ad3-4240-b465-e4c20ca182a4`
**Status:** completed
**Priority:** medium

Rex schema/index.ts already has fan-in documentation (finding 6 - acknowledged). Review web-dashboard's 9 entry points and consolidate where possible (finding 7).

---
