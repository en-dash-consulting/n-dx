---
id: "40cb95a7-c1d5-4fd0-8041-74c7a928215f"
level: "feature"
title: "Every PRD tool opens a v2 tree, and none can split it"
status: "pending"
priority: "critical"
tags:
  - "product-map"
  - "pr-33"
  - "lane-rex-store"
  - "rex"
  - "critical-path"
acceptanceCriteria: []
description: "Roadmap PR 33, stack A bottom layer (v2 Migration Path, card A1). Every v1 surface opens the PRD with resolveStore (store/index.ts), which returns FileStore; on a v2 tree FileStore.loadDocument falls back to the legacy files and throws ENOENT .rex/prd.json, which cli/errors.ts maps to \"Rex directory not found. Run 'n-dx init'\". About twenty MCP and CLI surfaces break this way. `rex init` also scaffolds prd_tree/ beside product/, a split brain where v2 tools read v2 and v1 tools silently read an empty v1 tree. ChangeLayerStore (store/change-layer-store.ts) already serves the change layer through the PRDStore interface; only reshape, prune and reorganize use it. This feature routes store resolution through it on v2, guards FileStore against a v2 tree, and makes the MCP tools and CLI commands serve or clearly refuse a v2 tree.\n\nDesign boundary (stack A, roadmap PRs 33 and 34; every change is checked against it):\n- Lane files: packages/rex/src/store/, packages/rex/src/cli/ (commands, mcp-tools, mcp-workspace, errors), packages/rex/src/core/ for selection and completion, packages/rex/src/public.ts, and their tests; packages/core only for `ndx status` and `ndx ci` where they spawn rex (spawn only, no library imports).\n- Not hench, not web, not the v2 schema (schema/v2.ts), not the migration pipeline (migrations/).\n- v1 trees keep today's behaviour exactly. This repository's own PRD is still v1 and hench works on it every day; existing v1 tests pass unedited.\n- The v2 isolation test (packages/rex/tests/unit/schema/v2.test.ts) gets each newly wired module added to its allowlist, with the comment's module list merged, as earlier layers did.\n- Fixtures: packages/rex/tests/fixtures/v2-tree. A test that writes copies it to a temp dir first.\n- Add a patch changeset for @n-dx/rex (plus @n-dx/core if ndx status or ndx ci changed). It lists every MCP field added on a v2 tree as a release-note line, because MCP tool shapes are soft-frozen since 0.9.0. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm):\n- Q1: resolveStore itself dispatches on layout. On a v2 tree (product/ exists) it returns the change-layer store (ChangeLayerStore, as resolveLayerStore builds it today), so every caller, hench and web included, stops failing at once. Add an explicit resolveV1Store for the few commands that must stay v1-only: migrate-*, restore and merge-driver.\n- Q2: a v2 answer from get_next_task, update_task_status, edit_item and the rest keeps the v1 field names and adds only optional fields (type, displayId, changeId, needsPlacement). Each added field gets a release-note line in the changeset.\n- Q3: move_item reparents a task between changes and refuses moving a change under a task; merge_items merges sibling changes only; edit_item maps `level` to nothing and refuses a level change; claim_task claims a task or a task-less change. Where ChangeLayerStore already defines a behaviour (PR 18), keep it.\n- Q4: Nick's #648 has not merged, so A2 exports only what hench and web need (reader, selection, completion, brief, transaction)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T07:10:12.306Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Resolve the store by layout, and refuse a split tree](./resolve-the-store-by-layout-and-refuse.md) | completed |
| [rex migrate-to-folder-tree, migrate-to-md and migrate-folder-tree-filenames do not refuse a v2 tree](./rex-migrate-to-folder-tree-migrate-to.md) | pending |
| [The rex CLI serves a v2 tree, and refuses what it cannot yet do](./the-rex-cli-serves-a-v2-tree-and.md) | pending |
| [The rex MCP tools serve a v2 tree](./the-rex-mcp-tools-serve-a-v2-tree.md) | pending |
