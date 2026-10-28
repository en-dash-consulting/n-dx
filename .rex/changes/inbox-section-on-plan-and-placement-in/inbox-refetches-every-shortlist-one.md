---
id: "6773438c-7c3f-4a98-8568-c8908c024270"
type: "task"
title: "Inbox refetches every shortlist, one full PRD model load each, on every rex:prd-changed"
slug: "inbox-refetches-every-shortlist-one"
description: "Verdict: should-fix (medium), found by adversarial review of ecac94e1 (commit 34100b64b).\n\nScenario: Plan is open with the Inbox section expanded (it opens by default while non-empty) and N open Inbox changes (19 today). Each rex:prd-changed (every task status change during `ndx work`, every capture) refetches /api/rex/changes, which hands useShortlists a new array, which fires N parallel GET /api/rex/changes/:id/placement. Each of those runs `loadPrdModel(ctx.rexDir)` over the whole tree (~1,224 changes in this repo) in handlePlacementRead (packages/web/src/server/routes-rex/placement.ts:224-231). So one PRD write costs N+1 full model loads per open dashboard tab, and grows with the Inbox.\n\nEvidence: packages/web/src/viewer/views/inbox.ts useShortlists (effect keyed on the `changes` array identity); placement.ts handlePlacementRead.\n\nReachability: ndx start + Plan page with a non-empty Inbox, while ndx work runs (the supported concurrent pairing).\n\nOptions:\n1. (Recommended) Server batch read: GET /api/rex/changes/placement?ids=… (or a `bestGuess` field on awaitsPlacement rows in GET /api/rex/changes) that loads the model once and returns every shortlist head. One request, one model load. Cost: one route + wire type + test; risk low.\n2. Client-only: refetch shortlists only for ids not already read, and drop reads for ids no longer listed. Cheap, but guesses go stale after a map edit until reload.\n3. Server-side memo of loadPrdModel keyed on the tree's mtime. Broader win, but touches every v2 read and the cache-invalidation story."
acceptanceCriteria:
  - "Rendering the Inbox with N awaiting changes loads the PRD model once on the server, not N+1 times (asserted by a route or integration test counting loadPrdModel calls)"
  - "A rex:prd-changed refresh of the Inbox issues a constant number of requests regardless of the number of Inbox rows (asserted in inbox.test.ts by counting fetched URLs)"
  - "Each row still shows its best guess and strength, and the strongest-first order is unchanged"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "inbox-placement"
  - "web"
source: "ndx-adversarial-review"
---
