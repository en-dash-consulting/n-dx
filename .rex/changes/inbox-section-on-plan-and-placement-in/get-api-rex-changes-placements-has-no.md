---
id: "4069b051-1e05-4867-aa2c-7df245ea7e6a"
type: "task"
title: "GET /api/rex/changes/placements has no wire type checked against the viewer's model"
slug: "get-api-rex-changes-placements-has-no"
description: "Verdict: should-fix (low), found by adversarial review of task 6773438c (commit ebd40ace9).\n\nScenario: placement.ts handlePlacementsRead answers `{ layout: \"v2\", placements: Record<id, ChangePlacementWire | { error }> }` as an inline literal, and viewer/views/inbox.ts readShortlists casts the body to an inline type. Every other placement route has a named `*Wire` type mirrored in viewer/views/product-model.ts and a `Same<>` compile-time check in tests/unit/server/routes-rex-product.test.ts. Renaming `placements` or the `{ error }` shape on one side compiles cleanly and the Inbox shows \"No shortlist for this change\" on every row.\n\nEvidence: packages/web/src/server/routes-rex/placement.ts handlePlacementsRead / buildAwaitingPlacements; packages/web/src/viewer/views/inbox.ts readShortlists.\n\nReachability: no failure today; contract drift that makes the next change riskier.\n\nFix (recommended): export `ChangePlacementsWire` from placement.ts, add `ChangePlacements` to product-model.ts, use it in readShortlists, and add a `Same<ChangePlacementsWire, ChangePlacements>` assertion beside samePlacement. Cost: a few lines; risk none."
acceptanceCriteria:
  - "placement.ts exports a named wire type for the GET /changes/placements answer and handlePlacementsRead uses it"
  - "product-model.ts declares the matching viewer type and inbox.ts readShortlists reads the body as it"
  - "routes-rex-product.test.ts holds a Same<> assertion between the two that fails to compile when they drift"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "inbox-placement"
  - "web"
source: "ndx-adversarial-review"
---
