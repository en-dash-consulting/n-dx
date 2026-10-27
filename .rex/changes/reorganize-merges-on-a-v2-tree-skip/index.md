---
id: "19326fda-e8a5-4063-8baa-5feada660fe8"
type: "change"
title: "reorganize merges on a v2 tree skip the change-layer merge rules, dropping touches and aliases"
slug: "reorganize-merges-on-a-v2-tree-skip"
intent: "Found by an adversarial review of cbecfdbf2 (merge_items on v2 keeps absorbed ids as aliases). Verdict: out-of-scope (it predates that change), severity medium.\n\nScenario: on a v2 tree, MCP `reorganize` (and CLI `rex reorganize`) still runs the similar-sibling merge detector (core/reorganize.ts:382, 521); `changeLayer` only skips the orphaned-feature and single-child detectors. Accepting a merge proposal goes through core/reorganize-executor.ts applyMerge (line 122), which calls mergeItems directly. It does not call validateChangeLayerMerge, carryTouches or carryAliases. Two similar changes merge and the absorbed change's `touches`, id, displayId and aliases are lost. N-DX-Item trailers naming the absorbed change stop counting toward the target's landing, shippedIn and realized-by (trailerIds, core/product-edges.ts). An absorbed change that carries `amends` loses its amendments, which merge_items refuses to do.\n\nSame gap, out of the rex lane: web's merge route (packages/web/src/server/routes-rex/items.ts:539) and prd-refinement.ts:746 call mergeItems directly. They need their own task if those surfaces serve v2.\n\nReachable: `reorganize` with accept on a v2 tree holding two similar sibling changes. No test covers it.\n\nOptions:\n1. (Recommended) Move the v2 merge rule into one core helper, e.g. `mergeChanges(items, sourceIds, targetId, options)`. It validates (validateChangeLayerMerge), carries touches and aliases, then calls mergeItems. Use it from merge-items.ts and from applyMerge when the store is the change layer. Cost: a small refactor plus one test. Risk: low, and v1 is unchanged.\n2. Have the merge detector propose nothing on the change layer, like the orphaned-feature and single-child detectors. Cheaper, but reorganize then never offers a v2 merge."
acceptanceCriteria:
  - "On a copy of the v2 fixture, accepting a reorganize merge of two sibling changes leaves the target with the absorbed change's touches and its id, displayId and former aliases as aliases (test that fails on the current head)"
  - "A reorganize merge that would absorb a change carrying amends is refused or never proposed on v2 (test)"
  - "The v2 merge rule lives in one core helper (validate, carry touches, carry aliases, then mergeItems) used by merge_items and by the reorganize executor when the store is the change layer"
  - "That helper is exported from public.ts so the dashboard's merge route (PR 36, D1-6) can call it through web's rex gateway; the v2 isolation allowlist and changeset public-entry list are updated"
  - "v1 reorganize merges and merge_items are unchanged; existing reorganize and merge tests pass unedited"
touches:
  - "40cb95a7-c1d5-4fd0-8041-74c7a928215f"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-33"
  - "lane-rex-store"
  - "review-2026-10-12"
source: "ndx-adversarial-review"
---
