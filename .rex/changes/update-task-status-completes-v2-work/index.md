---
id: "6a4bb0bf-80f0-4b85-9da2-29ac837e94a5"
type: "change"
title: "update_task_status completes v2 work through change-completion and apply"
slug: "update-task-status-completes-v2-work"
intent: "Wire v2 completion into update_task_status (MCP) and rex update --status (CLI). On a v2 tree, completing a task goes through completeTask/completeChange (core/change-completion.ts) inside withPrdModelTransaction (store/prd-model-transaction.ts): completing the last live task completes its change, and when rex.applyOn is \"complete\" (read with loadApplyOn) the apply engine runs in the same transaction. A task-less change that gains its first task follows the PR 16 split rule already implemented by addTask. The CLI and MCP paths share one implementation and behave the same. A v1 tree keeps today's cascade (core/parent-completion.ts) unchanged. The output keeps v1 field names, adding only optional Q2 fields (for example the completed change id and whether apply ran).\n\nDesign boundary (stack A, roadmap PRs 33 and 34; every change is checked against it):\n- Lane files: packages/rex/src/store/, packages/rex/src/cli/ (commands, mcp-tools, mcp-workspace, errors), packages/rex/src/core/ for selection and completion, packages/rex/src/public.ts, and their tests; packages/core only for `ndx status` and `ndx ci` where they spawn rex (spawn only, no library imports).\n- Not hench, not web, not the v2 schema (schema/v2.ts), not the migration pipeline (migrations/).\n- v1 trees keep today's behaviour exactly. This repository's own PRD is still v1 and hench works on it every day; existing v1 tests pass unedited.\n- The v2 isolation test (packages/rex/tests/unit/schema/v2.test.ts) gets each newly wired module added to its allowlist, with the comment's module list merged, as earlier layers did.\n- Fixtures: packages/rex/tests/fixtures/v2-tree. A test that writes copies it to a temp dir first.\n- Add a patch changeset for @n-dx/rex (plus @n-dx/core if ndx status or ndx ci changed). It lists every MCP field added on a v2 tree as a release-note line, because MCP tool shapes are soft-frozen since 0.9.0. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm):\n- Q1: resolveStore itself dispatches on layout. On a v2 tree (product/ exists) it returns the change-layer store (ChangeLayerStore, as resolveLayerStore builds it today), so every caller, hench and web included, stops failing at once. Add an explicit resolveV1Store for the few commands that must stay v1-only: migrate-*, restore and merge-driver.\n- Q2: a v2 answer from get_next_task, update_task_status, edit_item and the rest keeps the v1 field names and adds only optional fields (type, displayId, changeId, needsPlacement). Each added field gets a release-note line in the changeset.\n- Q3: move_item reparents a task between changes and refuses moving a change under a task; merge_items merges sibling changes only; edit_item maps `level` to nothing and refuses a level change; claim_task claims a task or a task-less change. Where ChangeLayerStore already defines a behaviour (PR 18), keep it.\n- Q4: Nick's #648 has not merged, so A2 exports only what hench and web need (reader, selection, completion, brief, transaction)."
acceptanceCriteria:
  - "Completing the last task of a change completes the change, and applyOn: complete runs the apply engine, inside withPrdModelTransaction (tests)"
  - "A task-less change split follows the PR 16 split rule (test)"
  - "rex update --status behaves the same as the MCP tool (test)"
  - "A v1 tree keeps today's cascade"
touches:
  - "b86f9199-bd84-45e8-95a8-bad39e42ebeb"
priority: "critical"
tags:
  - "pr-34"
  - "lane-rex-domain"
  - "rex"
blockedBy:
  - "214ed10c-05ee-4f6d-9ed6-baed06ac865a"
---
