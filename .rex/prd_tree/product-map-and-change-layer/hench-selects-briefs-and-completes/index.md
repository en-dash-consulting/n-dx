---
id: "be394022-52c9-4317-ab29-8bfa26523593"
level: "feature"
title: "hench selects, briefs and completes work on a v2 tree"
status: "pending"
priority: "critical"
tags:
  - "product-map"
  - "pr-35"
  - "lane-hench"
  - "hench"
  - "critical-path"
blockedBy:
  - "b86f9199-bd84-45e8-95a8-bad39e42ebeb"
acceptanceCriteria: []
description: "Roadmap PR 35, stack B (v2 Migration Path, card B1), based on roadmap PR 34 (feature b86f9199). On a v2 tree, ndx work cannot select, brief or complete a task: hench selects with the v1 findNextTask, briefs from the v1 item chain, writes status and completion through the v1 store, and its completion gate reads product/ and changes/ writes as leaked work. This feature makes hench select with rex's findNextWork, brief from buildChangeBrief, write status, completion and claims through rex's v2 transaction, and treat the v2 folders as PRD bookkeeping, all through packages/hench/src/prd/rex-gateway.ts.\n\nOverlap: this overlaps Hal's feature 20d12416 (\"Agent brief from the product layer\") and its task 6daf36b5 (\"Let agents read capabilities and place follow-ups; run task-less changes\"). Ryan owns this work by decision D7 of the v2 Migration Path (2026-10-12).\n\nDesign boundary (roadmap PR 35, stack B; every change is checked against it):\n- Lane files: packages/hench (src and tests), plus the two root tests tests/e2e/architecture-policy.test.js (gateway export ceiling, with a \"Raised from X to Y for …\" description entry) and tests/integration/cross-package-contracts.test.js.\n- Not rex and not web. hench consumes rex only through its public API (packages/rex/src/public.ts, as exported by roadmap PR 34 task T6), and only through packages/hench/src/prd/rex-gateway.ts (re-export only, no logic; type imports through the gateway too). If something hench needs is not exported by rex, stop and report it rather than editing rex.\n- v1 trees keep today's behaviour exactly: this repository's own PRD is v1 and hench works on it every day; existing v1 tests pass unedited.\n- On a v2 tree (rex's prdLayout reports \"v2\") hench never writes through a v1 FileStore and never writes prd_tree/.\n- Fixtures: packages/rex/tests/fixtures/v2-tree (copy it to a temp dir before any test that writes).\n- Add a patch changeset for @n-dx/hench. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm): stack A's Q1–Q4 hold (resolveStore dispatches on layout; v1 field names kept with optional v2 fields; #648 not merged, so rex exports only what hench and web need). `--epic-by-epic` refuses on v2 rather than mapping epics to changes (the epic level does not exist on v2; mapping is a later decision)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T09:54:14.064Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [hench briefs a v2 task from its change](./hench-briefs-a-v2-task-from-its-change.md) | completed |
| [hench reopens an applied v2 change when it withdraws a bypassed completion](./hench-reopens-an-applied-v2-change.md) | pending |
| [hench's completion on a v2 tree bypasses change-completion and never applies the change](./hench-s-completion-on-a-v2-tree.md) | pending |
| [hench selects v2 work and finds a task by id](./hench-selects-v2-work-and-finds-a-task.md) | completed |
| [hench writes status, completion and claims through the v2 transaction](./hench-writes-status-completion-and.md) | completed |
| [ndx work --task=<display id> --resolve reports "Task not found" on a v2 tree](./ndx-work-task-display-id-resolve.md) | pending |
| [ndx work --task on a v2 change with tasks claims the change while another worktree holds one of its tasks](./ndx-work-task-on-a-v2-change-with.md) | pending |
| [On a v2 tree hench's brief can drop workflow.md whole when rex's 4,000-token budget runs out](./on-a-v2-tree-hench-s-brief-can-drop.md) | pending |
| [Re-record the prompt-census baseline for hench's v2 brief](./re-record-the-prompt-census-baseline.md) | completed |
| [The completion gate and review captures understand v2](./the-completion-gate-and-review.md) | pending |
