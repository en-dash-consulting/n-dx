---
id: "44043b84-1a8e-4ead-adf7-41d98f338bc2"
level: "task"
title: "hench writes status, completion and claims through the v2 transaction"
status: "completed"
priority: "critical"
tags:
  - "pr-35"
  - "lane-hench"
  - "hench"
blockedBy:
  - "dfb907e5-c2ab-4d02-85d1-5a668d91d369"
startedAt: "2026-10-12T10:31:54.842Z"
completedAt: "2026-10-12T10:41:18.227Z"
endedAt: "2026-10-12T10:41:18.227Z"
resolutionType: "code-change"
resolutionDetail: "On v2, toolRexUpdateStatus completes through rex's completeV2Work (via rex-gateway): last task completes and applies its change; the v1 cascade is skipped on v2. Claims and the FileStore guard are covered by tests/integration/v2-status-completion.test.ts. v1 unchanged."
acceptanceCriteria:
  - "Completing the last task completes its change and runs apply-on-complete, as rex's update_task_status does on v2 (test)"
  - "Claims work on v2 (test)"
  - "No FileStore write ever happens on a v2 tree (test)"
description: "On a v2 tree, hench writes status, completion and claims through rex's v2 runtime: completeV2Work (exported by PR 34 T6), the same entry point rex's update_task_status uses on v2, inside withPrdModelTransaction. Today hench applies a held completion itself after its test gate (packages/hench/src/tools/rex.ts, computeTimestampUpdates + store.updateItem + reconcileAutoCompletions), which on v2 bypasses change-completion and never applies the change (captured as c1c8888b, closed by this task): completing the last task completes its change and runs apply-on-complete. Claims work on v2 (task, or task-less change). No FileStore write ever happens on a v2 tree (test, e.g. a spy or a FileStore guard assertion). v1 status writes and cascade are unchanged.\n\nDesign boundary (roadmap PR 35, stack B; every change is checked against it):\n- Lane files: packages/hench (src and tests), plus the two root tests tests/e2e/architecture-policy.test.js (gateway export ceiling, with a \"Raised from X to Y for …\" description entry) and tests/integration/cross-package-contracts.test.js.\n- Not rex and not web. hench consumes rex only through its public API (packages/rex/src/public.ts, as exported by roadmap PR 34 task T6), and only through packages/hench/src/prd/rex-gateway.ts (re-export only, no logic; type imports through the gateway too). If something hench needs is not exported by rex, stop and report it rather than editing rex.\n- v1 trees keep today's behaviour exactly: this repository's own PRD is v1 and hench works on it every day; existing v1 tests pass unedited.\n- On a v2 tree (rex's prdLayout reports \"v2\") hench never writes through a v1 FileStore and never writes prd_tree/.\n- Fixtures: packages/rex/tests/fixtures/v2-tree (copy it to a temp dir before any test that writes).\n- Add a patch changeset for @n-dx/hench. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm): stack A's Q1–Q4 hold (resolveStore dispatches on layout; v1 field names kept with optional v2 fields; #648 not merged, so rex exports only what hench and web need). `--epic-by-epic` refuses on v2 rather than mapping epics to changes (the epic level does not exist on v2; mapping is a later decision)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T10:41:18.502Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
