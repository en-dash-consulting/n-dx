---
id: "49a1b628-345d-46bf-8d30-7645cb6d50db"
type: "change"
title: "The area read rebuilds rex's whole-tree placement inputs once per Inbox change"
slug: "the-area-read-rebuilds-rex-s-whole"
intent: "Severity medium; verdict should-fix (adversarial review of task 50c98ea3).\n\nScenario: on every GET /api/rex/product/area/<slug>, buildAreaDetail (packages/web/src/server/routes-rex/product.ts) calls rex suggestPlacement once for every open Inbox change. Each call re-indexes the tree, rebuilds placementNodes and recomputes openAmenders (packages/rex/src/core/change-place.ts:138-175), so the cost is O(Inbox × tree). On this repository's PRD (1,511 changes, 27 in the Inbox) that is ~340 ms of a ~720–800 ms answer, including ~450 ms of model load. At roughly 60 Inbox changes, any area read passes the 1-second budget the area-read task set. The same per-change pattern makes GET /api/rex/changes/placements slow.\n\nReachable: yes. Every area-view open and reload, and every Plan Inbox read.\n\nOptions:\n(a) Recommended. Add a rex batch suggestPlacements(tree, refs), or have suggestPlacement take a prepared context, so the index, placement nodes and open amenders are built once per call. It needs one gateway export, so swap out an unused one: the web rex gateway is at its 135 ceiling. Low risk: the same ranking, computed once.\n(b) Cache Inbox guesses in web keyed by the PRD snapshot. Cheaper in rex but adds cache invalidation in web."
acceptanceCriteria:
  - "Suggesting placements for N Inbox changes builds rex's tree index, placement nodes and open-amender map once, not N times"
  - "A rex unit test shows the batch result equals per-change suggestPlacement for every Inbox change on a fixture"
  - "GET /api/rex/product/area/<slug> answers under one second on this repository's PRD with 60 Inbox changes"
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
priority: "medium"
discoveredFrom: {"item":"50c98ea3-d30c-4eea-8df7-fece3958d327","run":"49af2b01-7fba-499c-84ac-4ecb71cdd3f7"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
