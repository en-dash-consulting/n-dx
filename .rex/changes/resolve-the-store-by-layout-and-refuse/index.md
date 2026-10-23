---
id: "74584d30-c16b-4bdc-ab37-27a2df75fdcf"
type: "change"
title: "Resolve the store by layout, and refuse a split tree"
slug: "resolve-the-store-by-layout-and-refuse"
intent: "Make store resolution layout-aware and close the split-brain hazard. resolveStore (packages/rex/src/store/index.ts) returns the change-layer store on a v2 tree (product/ present) and FileStore on v1, per Q1; add resolveV1Store and use it in migrate-*, restore and merge-driver. FileStore refuses to load or write when product/ exists, naming the v2 layout (ChangeLayerStore must keep working, so make sure whatever FileStore it wraps does not trip the guard for the reads it legitimately does, or route those reads another way). `rex init` (cli/commands/init.ts) never scaffolds prd_tree/ when product/ exists. The ENOENT → \"Run 'n-dx init'\" mapping in cli/errors.ts fires only when the project has no PRD in either layout.\n\nDesign boundary (stack A, roadmap PRs 33 and 34; every change is checked against it):\n- Lane files: packages/rex/src/store/, packages/rex/src/cli/ (commands, mcp-tools, mcp-workspace, errors), packages/rex/src/core/ for selection and completion, packages/rex/src/public.ts, and their tests; packages/core only for `ndx status` and `ndx ci` where they spawn rex (spawn only, no library imports).\n- Not hench, not web, not the v2 schema (schema/v2.ts), not the migration pipeline (migrations/).\n- v1 trees keep today's behaviour exactly. This repository's own PRD is still v1 and hench works on it every day; existing v1 tests pass unedited.\n- The v2 isolation test (packages/rex/tests/unit/schema/v2.test.ts) gets each newly wired module added to its allowlist, with the comment's module list merged, as earlier layers did.\n- Fixtures: packages/rex/tests/fixtures/v2-tree. A test that writes copies it to a temp dir first.\n- Add a patch changeset for @n-dx/rex (plus @n-dx/core if ndx status or ndx ci changed). It lists every MCP field added on a v2 tree as a release-note line, because MCP tool shapes are soft-frozen since 0.9.0. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm):\n- Q1: resolveStore itself dispatches on layout. On a v2 tree (product/ exists) it returns the change-layer store (ChangeLayerStore, as resolveLayerStore builds it today), so every caller, hench and web included, stops failing at once. Add an explicit resolveV1Store for the few commands that must stay v1-only: migrate-*, restore and merge-driver.\n- Q2: a v2 answer from get_next_task, update_task_status, edit_item and the rest keeps the v1 field names and adds only optional fields (type, displayId, changeId, needsPlacement). Each added field gets a release-note line in the changeset.\n- Q3: move_item reparents a task between changes and refuses moving a change under a task; merge_items merges sibling changes only; edit_item maps `level` to nothing and refuses a level change; claim_task claims a task or a task-less change. Where ChangeLayerStore already defines a behaviour (PR 18), keep it.\n- Q4: Nick's #648 has not merged, so A2 exports only what hench and web need (reader, selection, completion, brief, transaction)."
acceptanceCriteria:
  - "On a v2 tree, store resolution returns the change-layer store (per Q1) (test)"
  - "FileStore refuses to load or write when product/ exists, with a message naming the v2 layout (test)"
  - "rex init on a tree with product/ creates no prd_tree/ (test)"
  - "The ENOENT → 'run n-dx init' hint fires only when the project has no PRD in either layout; a v2 tree never gets it (test)"
touches:
  - "40cb95a7-c1d5-4fd0-8041-74c7a928215f"
priority: "critical"
tags:
  - "pr-33"
  - "lane-rex-store"
  - "rex"
---
