---
id: "bf377f39-6996-4331-9a0c-fb102d07ce5b"
level: "task"
title: "hench selects v2 work and finds a task by id"
status: "pending"
priority: "critical"
tags:
  - "pr-35"
  - "lane-hench"
  - "hench"
acceptanceCriteria:
  - "On a v2 tree, ndx work with no --task picks work with rex's findNextWork through packages/hench/src/prd/rex-gateway.ts (test)"
  - "--task accepts an id or a display id (test)"
  - "--loop continues across v2 tasks (test)"
  - "--epic-by-epic refuses on v2, naming the reason (test)"
  - "The gateway export ceiling in tests/e2e/architecture-policy.test.js is raised with a 'Raised from X to Y for …' description entry, and tests/integration/cross-package-contracts.test.js is updated"
description: "On a v2 tree, ndx work selects work with rex's v2 selection (PR 34 T6 exports findNextWork, findNextWorkTask, resolveWorkById and completedWorkIds; use the same entry point rex's get_next_task uses on v2) through packages/hench/src/prd/rex-gateway.ts, instead of the v1 findNextTask. `--task` accepts an id or a display id (resolveWorkById). `--loop` continues across v2 tasks. `--epic-by-epic` refuses on v2 with a message naming the reason (no epic level on v2). Raise the gateway export ceiling in tests/e2e/architecture-policy.test.js with a \"Raised from X to Y for …\" description entry, and update tests/integration/cross-package-contracts.test.js for the new gateway exports. v1 selection is unchanged.\n\nDesign boundary (roadmap PR 35, stack B; every change is checked against it):\n- Lane files: packages/hench (src and tests), plus the two root tests tests/e2e/architecture-policy.test.js (gateway export ceiling, with a \"Raised from X to Y for …\" description entry) and tests/integration/cross-package-contracts.test.js.\n- Not rex and not web. hench consumes rex only through its public API (packages/rex/src/public.ts, as exported by roadmap PR 34 task T6), and only through packages/hench/src/prd/rex-gateway.ts (re-export only, no logic; type imports through the gateway too). If something hench needs is not exported by rex, stop and report it rather than editing rex.\n- v1 trees keep today's behaviour exactly: this repository's own PRD is v1 and hench works on it every day; existing v1 tests pass unedited.\n- On a v2 tree (rex's prdLayout reports \"v2\") hench never writes through a v1 FileStore and never writes prd_tree/.\n- Fixtures: packages/rex/tests/fixtures/v2-tree (copy it to a temp dir before any test that writes).\n- Add a patch changeset for @n-dx/hench. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm): stack A's Q1–Q4 hold (resolveStore dispatches on layout; v1 field names kept with optional v2 fields; #648 not merged, so rex exports only what hench and web need). `--epic-by-epic` refuses on v2 rather than mapping epics to changes (the epic level does not exist on v2; mapping is a later decision)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T09:54:14.589Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
