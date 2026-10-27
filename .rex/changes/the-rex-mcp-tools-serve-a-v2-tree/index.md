---
id: "c026ba0d-b8bf-48e4-8f66-9d75cab27fb9"
type: "change"
title: "The rex MCP tools serve a v2 tree"
slug: "the-rex-mcp-tools-serve-a-v2-tree"
intent: "Make the rex MCP tools serve a v2 tree through the layout-aware store from T1. Covers edit_item, move_item, merge_items, claim_task, release_task, verify_criteria, facets, health, reorganize and get_token_usage, with the Q2 output shapes and the Q3 operation semantics. The MCP workspace (cli/mcp-workspace.ts, around line 65) opens the right store for the layout. get_next_task and update_task_status selection/completion semantics are A2's (T4, T5); this task only needs them not to crash on the store. One test per tool on a temp copy of the v2 fixture.\n\nDesign boundary (stack A, roadmap PRs 33 and 34; every change is checked against it):\n- Lane files: packages/rex/src/store/, packages/rex/src/cli/ (commands, mcp-tools, mcp-workspace, errors), packages/rex/src/core/ for selection and completion, packages/rex/src/public.ts, and their tests; packages/core only for `ndx status` and `ndx ci` where they spawn rex (spawn only, no library imports).\n- Not hench, not web, not the v2 schema (schema/v2.ts), not the migration pipeline (migrations/).\n- v1 trees keep today's behaviour exactly. This repository's own PRD is still v1 and hench works on it every day; existing v1 tests pass unedited.\n- The v2 isolation test (packages/rex/tests/unit/schema/v2.test.ts) gets each newly wired module added to its allowlist, with the comment's module list merged, as earlier layers did.\n- Fixtures: packages/rex/tests/fixtures/v2-tree. A test that writes copies it to a temp dir first.\n- Add a patch changeset for @n-dx/rex (plus @n-dx/core if ndx status or ndx ci changed). It lists every MCP field added on a v2 tree as a release-note line, because MCP tool shapes are soft-frozen since 0.9.0. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm):\n- Q1: resolveStore itself dispatches on layout. On a v2 tree (product/ exists) it returns the change-layer store (ChangeLayerStore, as resolveLayerStore builds it today), so every caller, hench and web included, stops failing at once. Add an explicit resolveV1Store for the few commands that must stay v1-only: migrate-*, restore and merge-driver.\n- Q2: a v2 answer from get_next_task, update_task_status, edit_item and the rest keeps the v1 field names and adds only optional fields (type, displayId, changeId, needsPlacement). Each added field gets a release-note line in the changeset.\n- Q3: move_item reparents a task between changes and refuses moving a change under a task; merge_items merges sibling changes only; edit_item maps `level` to nothing and refuses a level change; claim_task claims a task or a task-less change. Where ChangeLayerStore already defines a behaviour (PR 18), keep it.\n- Q4: Nick's #648 has not merged, so A2 exports only what hench and web need (reader, selection, completion, brief, transaction)."
acceptanceCriteria:
  - "edit_item, move_item, merge_items, claim_task, release_task, verify_criteria, facets, health, reorganize and get_token_usage each succeed on the v2 fixture tree with the Q2/Q3 behaviour (one test per tool)"
  - "A v1 tree behaves exactly as before (existing tests pass)"
  - "The MCP workspace (cli/mcp-workspace.ts) opens the right store for the layout"
touches:
  - "40cb95a7-c1d5-4fd0-8041-74c7a928215f"
priority: "critical"
tags:
  - "pr-33"
  - "lane-rex-store"
  - "rex"
blockedBy:
  - "74584d30-c16b-4bdc-ab37-27a2df75fdcf"
---
