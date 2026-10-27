---
id: "b0dbec5f-8219-49a5-a53b-e928914eccf8"
type: "change"
title: "The dashboard's merge route and refinement merge follow the v2 change-layer merge rules"
slug: "the-dashboard-s-merge-route-and"
intent: "Review 2026-10-12, found by the adversarial review of 3ba2a3ca (PR 33, run eccde85e) and filed in rex as 19326fda, which names this web half as needing its own task. Decision (Ryan, 2026-10-12): in this round, after 19326fda lands and merges up.\n\nDefect: the dashboard merges PRD items with rex's plain mergeItems, which on a v2 tree skips the change-layer merge rules (validateChangeLayerMerge, carryTouches, carryAliases):\n- POST merge route, packages/web/src/server/routes-rex/items.ts:623-635 (`mergeItems(doc.items, input.sourceIds, input.targetId, options)` inside store.withTransaction);\n- refinement merge, packages/web/src/server/prd-refinement.ts:746 (`mergeItems(doc.items, [proposal.itemId, proposal.intoId], proposal.intoId)`).\nBoth reach mergeItems through src/server/rex-gateway.ts:119.\n\nFailure scenario: on a v2 project, merging two sibling changes from the dashboard (or accepting a refinement merge) drops the absorbed change's touches and its id, displayId and aliases, so N-DX-Item trailers naming it stop counting toward the target's landing, shippedIn and realized-by; and an absorbed change carrying amends loses its amendments silently, which MCP merge_items refuses. ChangeLayerStore's newErrors backstop does not catch a lost touch or alias. Merging a task, which merge_items refuses on v2, is not refused here either.\n\nFix: on a v2 project (isChangeLayerStore(store)), both call sites use the v2 merge helper 19326fda adds and exports from rex's public entry, imported through rex-gateway.ts (re-export only; raise the gateway export ceiling with a \"Raised from X to Y\" entry in docs/architecture/gateways.md and update cross-package-contracts.test.js). A refused v2 merge answers 400 with rex's reason and writes nothing. v1 merges are unchanged."
acceptanceCriteria:
  - "On a v2 copy, POST to the dashboard merge route merging two sibling changes leaves the target with the absorbed change's touches and its id, displayId and former aliases as aliases (route test that fails on 4a7b64a8c8)"
  - "A dashboard merge that would absorb a change carrying amends, or merge a task, answers 400 with rex's reason and writes nothing (route test)"
  - "The refinement merge (prd-refinement.ts) uses the same v2 rule on a v2 project (test)"
  - "The health route's reorganize apply (routes-rex/health.ts ~118-124) passes changeLayer to detectReorganizations and applyProposals on a v2 project, proposes no v1 orphan or single-child collapse, and merges through mergeChanges (test)"
  - "mergeChanges, validateChangesMerge and ChangesMergeOutcome reach web only through rex-gateway.ts; the gateway ceiling, gateways.md and cross-package contract lists are updated"
  - "v1 merge routes are unchanged; existing tests pass unedited"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "high"
tags:
  - "pr-36"
  - "review-2026-10-12"
  - "lane-web"
source: "review-2026-10-12"
blockedBy:
  - "19326fda-e8a5-4063-8baa-5feada660fe8"
---
