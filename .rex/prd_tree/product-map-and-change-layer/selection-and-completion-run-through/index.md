---
id: "b86f9199-bd84-45e8-95a8-bad39e42ebeb"
level: "feature"
title: "Selection and completion run through the v2 rules"
status: "completed"
priority: "critical"
tags:
  - "product-map"
  - "pr-34"
  - "lane-rex-domain"
  - "rex"
  - "critical-path"
blockedBy:
  - "40cb95a7-c1d5-4fd0-8041-74c7a928215f"
startedAt: "2026-10-12T09:52:33.548Z"
completedAt: "2026-10-13T16:11:27.352Z"
endedAt: "2026-10-13T16:11:27.352Z"
acceptanceCriteria: []
description: "Roadmap PR 34, stack A top layer (v2 Migration Path, card A2), based on A1 (feature 40cb95a7). findNextWork (core/change-selection.ts) and completeTask/completeChange (core/change-completion.ts) were built by b0467938 and 3d03ab41 but are called only by tests, and packages/rex/src/public.ts exports none of the v2 runtime. On top of A1's layout-aware store, this feature wires get_next_task and rex next to findNextWork, wires update_task_status and rex update --status to change-completion and apply-on-complete inside the PRD transaction, and exports the v2 runtime that hench (stack B, roadmap PR 35) and the dashboard (D1, roadmap PR 36) consume through their gateways. A projection alone would ignore placement and task-less changes, and would complete changes without applying them.\n\nDesign boundary (stack A, roadmap PRs 33 and 34; every change is checked against it):\n- Lane files: packages/rex/src/store/, packages/rex/src/cli/ (commands, mcp-tools, mcp-workspace, errors), packages/rex/src/core/ for selection and completion, packages/rex/src/public.ts, and their tests; packages/core only for `ndx status` and `ndx ci` where they spawn rex (spawn only, no library imports).\n- Not hench, not web, not the v2 schema (schema/v2.ts), not the migration pipeline (migrations/).\n- v1 trees keep today's behaviour exactly. This repository's own PRD is still v1 and hench works on it every day; existing v1 tests pass unedited.\n- The v2 isolation test (packages/rex/tests/unit/schema/v2.test.ts) gets each newly wired module added to its allowlist, with the comment's module list merged, as earlier layers did.\n- Fixtures: packages/rex/tests/fixtures/v2-tree. A test that writes copies it to a temp dir first.\n- Add a patch changeset for @n-dx/rex (plus @n-dx/core if ndx status or ndx ci changed). It lists every MCP field added on a v2 tree as a release-note line, because MCP tool shapes are soft-frozen since 0.9.0. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm):\n- Q1: resolveStore itself dispatches on layout. On a v2 tree (product/ exists) it returns the change-layer store (ChangeLayerStore, as resolveLayerStore builds it today), so every caller, hench and web included, stops failing at once. Add an explicit resolveV1Store for the few commands that must stay v1-only: migrate-*, restore and merge-driver.\n- Q2: a v2 answer from get_next_task, update_task_status, edit_item and the rest keeps the v1 field names and adds only optional fields (type, displayId, changeId, needsPlacement). Each added field gets a release-note line in the changeset.\n- Q3: move_item reparents a task between changes and refuses moving a change under a task; merge_items merges sibling changes only; edit_item maps `level` to nothing and refuses a level change; claim_task claims a task or a task-less change. Where ChangeLayerStore already defines a behaviour (PR 18), keep it.\n- Q4: Nick's #648 has not merged, so A2 exports only what hench and web need (reader, selection, completion, brief, transaction)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T16:11:27.643Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [#716's writer test expects the result shape before the save report added deletedFiles](./716-s-writer-test-expects-the-result.md) | completed |
| [A claim on a task-less change covers the task it splits into](./a-claim-on-a-task-less-change-covers.md) | completed |
| [Change selection descends into a change nested under another change](./change-selection-descends-into-a.md) | completed |
| [ChangeLayerStore writes return a save report of the paths written and deleted](./changelayerstore-writes-return-a-save.md) | completed |
| [gateways.md describes the rex v2 surface as it is after #648 and the restack](./gateways-md-describes-the-rex-v2.md) | completed |
| [get_next_task and rex next pick v2 work with findNextWork](./get-next-task-and-rex-next-pick-v2.md) | completed |
| [get_prd_status on v2 drops capabilities and open changes under a nested area](./get-prd-status-on-v2-drops.md) | completed |
| [Pin rex update's v2 order: complete first, write the other fields only if the completion succeeded](./pin-rex-update-s-v2-order-complete.md) | completed |
| [resolveWorkById and claim_task treat a change that holds a nested change as a runnable unit](./resolveworkbyid-and-claim-task-treat-a.md) | completed |
| [rex does not export enclosingChangeIds, so hench's explicit --task on v2 can claim a task inside a change another worktree holds](./rex-does-not-export-enclosingchangeids.md) | completed |
| [rex exports the v2 runtime for hench and the dashboard](./rex-exports-the-v2-runtime-for-hench.md) | completed |
| [update_task_status completes and applies a change that holds an open nested change](./update-task-status-completes-and.md) | completed |
| [update_task_status completes v2 work through change-completion and apply](./update-task-status-completes-v2-work.md) | completed |
