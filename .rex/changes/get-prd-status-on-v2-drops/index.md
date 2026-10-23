---
id: "5b52f367-ce20-4eb2-a53e-23293ced070f"
type: "change"
title: "get_prd_status on v2 drops capabilities and open changes under a nested area"
slug: "get-prd-status-on-v2-drops"
intent: "Verdict: should-fix (severity medium). Found by the adversarial review of task 9a441abb.\n\nFailure: `prdStatusReport` (packages/rex/src/core/product-report.ts:194-224) maps every node to its NEAREST area (`areaOf`), but `areas` lists only top-level areas (`tree.product.filter(n => n.type === \"area\")`). No v2 rule forbids an area nested in an area (`layer-nesting` checks only the layer; `area-balance` already treats a nested area as its own area). So for product: A1 (area) → A1.1 (area) → capability X, plus an open change amending X, `get_prd_status` returns `areas: [{ A1, capabilities: 0, openChanges: 0 }]`. X, its status and its open change appear nowhere in the per-area report. The output is silently wrong, not refused.\n\nReachable through rex MCP `get_prd_status` on any v2 tree that nests areas. Not covered: product-report.test.ts only uses single-level areas.\n\nOptions:\n1. Map each node to its top-level area (walk to the root area instead of the nearest one). Cheap, and keeps one row per top-level area. Recommended.\n2. List every area, nested ones included, with a parent reference. This gives a richer shape but changes the output contract.\n\nRoadmap PR 34 task T7 (moved under feature b86f9199 on 2026-10-12, run last). Take option 1 (map each node to its top-level area), which keeps get_prd_status's output contract.\nDesign boundary (stack A, roadmap PRs 33 and 34; every change is checked against it):\n- Lane files: packages/rex/src/store/, packages/rex/src/cli/ (commands, mcp-tools, mcp-workspace, errors), packages/rex/src/core/ for selection and completion, packages/rex/src/public.ts, and their tests; packages/core only for `ndx status` and `ndx ci` where they spawn rex (spawn only, no library imports).\n- Not hench, not web, not the v2 schema (schema/v2.ts), not the migration pipeline (migrations/).\n- v1 trees keep today's behaviour exactly. This repository's own PRD is still v1 and hench works on it every day; existing v1 tests pass unedited.\n- The v2 isolation test (packages/rex/tests/unit/schema/v2.test.ts) gets each newly wired module added to its allowlist, with the comment's module list merged, as earlier layers did.\n- Fixtures: packages/rex/tests/fixtures/v2-tree. A test that writes copies it to a temp dir first.\n- Add a patch changeset for @n-dx/rex (plus @n-dx/core if ndx status or ndx ci changed). It lists every MCP field added on a v2 tree as a release-note line, because MCP tool shapes are soft-frozen since 0.9.0. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm):\n- Q1: resolveStore itself dispatches on layout. On a v2 tree (product/ exists) it returns the change-layer store (ChangeLayerStore, as resolveLayerStore builds it today), so every caller, hench and web included, stops failing at once. Add an explicit resolveV1Store for the few commands that must stay v1-only: migrate-*, restore and merge-driver.\n- Q2: a v2 answer from get_next_task, update_task_status, edit_item and the rest keeps the v1 field names and adds only optional fields (type, displayId, changeId, needsPlacement). Each added field gets a release-note line in the changeset.\n- Q3: move_item reparents a task between changes and refuses moving a change under a task; merge_items merges sibling changes only; edit_item maps `level` to nothing and refuses a level change; claim_task claims a task or a task-less change. Where ChangeLayerStore already defines a behaviour (PR 18), keep it.\n- Q4: Nick's #648 has not merged, so A2 exports only what hench and web need (reader, selection, completion, brief, transaction).\n"
acceptanceCriteria:
  - "prdStatusReport counts a capability under an area nested in a top-level area toward a listed area row (or lists the nested area)"
  - "An open change amending a capability under a nested area is counted in some listed area's openChanges"
  - "A unit test in product-report.test.ts with a nested area covers both cases and fails on the current code"
touches:
  - "b86f9199-bd84-45e8-95a8-bad39e42ebeb"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-34"
  - "lane-rex-domain"
  - "rex"
source: "ndx-adversarial-review"
blockedBy:
  - "7117be30-ffb3-44db-a008-6a7014392507"
---
