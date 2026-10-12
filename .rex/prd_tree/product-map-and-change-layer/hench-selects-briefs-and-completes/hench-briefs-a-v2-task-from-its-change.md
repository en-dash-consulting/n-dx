---
id: "dfb907e5-c2ab-4d02-85d1-5a668d91d369"
level: "task"
title: "hench briefs a v2 task from its change"
status: "completed"
priority: "critical"
tags:
  - "pr-35"
  - "lane-hench"
  - "hench"
blockedBy:
  - "bf377f39-6996-4331-9a0c-fb102d07ce5b"
startedAt: "2026-10-12T10:11:39.426Z"
completedAt: "2026-10-12T10:31:41.038Z"
endedAt: "2026-10-12T10:31:41.038Z"
resolutionType: "code-change"
resolutionDetail: "Work landed in b86a911cf (run 8e84c4d6, opus-5-5 / opus-5-5 review, v1 brief byte-identical per both reviews). Both runs 8e84c4d6 and c5687b94 failed the gate only on tests/e2e/prompt-census.test.js, because the baseline was not re-recorded for the +3 tokens of v2 fixed text in formatTaskBrief. Task 823cb29d (run 6d95babb, b80f8662c) regenerated the baseline; its gate is green. Closed overnight through rex."
acceptanceCriteria:
  - "On v2 the brief comes from buildChangeBrief, through the gateway (test)"
  - "On v1 the brief is unchanged (existing tests)"
description: "On a v2 tree, the agent brief comes from rex's buildChangeBrief (through the gateway): the change, its task, and the capabilities and constraints it touches or amends. On v1 the brief is unchanged (existing brief tests pass unedited).\n\nDesign boundary (roadmap PR 35, stack B; every change is checked against it):\n- Lane files: packages/hench (src and tests), plus the two root tests tests/e2e/architecture-policy.test.js (gateway export ceiling, with a \"Raised from X to Y for …\" description entry) and tests/integration/cross-package-contracts.test.js.\n- Not rex and not web. hench consumes rex only through its public API (packages/rex/src/public.ts, as exported by roadmap PR 34 task T6), and only through packages/hench/src/prd/rex-gateway.ts (re-export only, no logic; type imports through the gateway too). If something hench needs is not exported by rex, stop and report it rather than editing rex.\n- v1 trees keep today's behaviour exactly: this repository's own PRD is v1 and hench works on it every day; existing v1 tests pass unedited.\n- On a v2 tree (rex's prdLayout reports \"v2\") hench never writes through a v1 FileStore and never writes prd_tree/.\n- Fixtures: packages/rex/tests/fixtures/v2-tree (copy it to a temp dir before any test that writes).\n- Add a patch changeset for @n-dx/hench. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm): stack A's Q1–Q4 hold (resolveStore dispatches on layout; v1 field names kept with optional v2 fields; #648 not merged, so rex exports only what hench and web need). `--epic-by-epic` refuses on v2 rather than mapping epics to changes (the epic level does not exist on v2; mapping is a later decision)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T10:31:42.577Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
