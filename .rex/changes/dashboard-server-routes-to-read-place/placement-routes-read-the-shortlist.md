---
id: "ed64adff-ca54-4b02-8adb-67616ff02c2b"
type: "task"
title: "Placement routes: read the shortlist, place, and propose"
slug: "placement-routes-read-the-shortlist"
description: "New `packages/web/src/server/routes-rex/placement.ts`, wired in `routes-rex/index.ts`:\n\nGET /api/rex/changes/:id/placement → `{ layout: \"v2\", change: { id, title, intent?, status, taskCount, tags? }, relation, tied, shortlist: [{ target, type, title, area, statement?, criteria: [{id,text}], score, strength, reasons }] }`. `area` is the title of the candidate's nearest area ancestor (resolve through `indexTree`).\n\nPOST /api/rex/changes/:id/place, body `{ target, relation?, summary?, proposed?, criteria? }` → `{ change, target, relation, warnings? }`, via `recordPlacement`.\n\nPOST /api/rex/changes/:id/propose, body `{ type, under, title, summary?, proposed?, criteria? }` → `{ change, proposed: { target, under, title, type } }`, via `recordProposal`.\n\nWrites run inside `withPrdModelTransaction` (holds the PRD lock), append `change_placed` / `change_proposed` with `appendLog` from `rex-route-helpers.ts`, and broadcast `rex:prd-changed`. `ChangePlacementError` → 422 `{ error: err.plain, kind: err.kind }`; v1 → 409; unknown change → 404. Follow the request gate and workspace-scoped write rules in `packages/web/src/server/AGENTS.md`. Mirror the wire types in `viewer/views/product-model.ts` and extend the compile-time drift check in `tests/unit/server/routes-rex-product.test.ts`."
acceptanceCriteria:
  - "The three routes answer with the documented shapes on the v2-product-map fixture"
  - "A successful place or propose clears needsPlacement, moves the change folder out of changes/inbox/ and appends to the execution log"
  - "Each ChangePlacementError kind maps to 422 with its plain message and kind"
  - "v1 answers 409 and an unknown change 404"
  - "routes-rex-placement.test.ts covers success, refusals, v1 and the broadcast"
priority: "high"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
