---
id: "aabf1250-55d6-474d-8bd2-205cabfa3ad9"
type: "change"
title: "Bulk status PATCH completes v2 work without rex's v2 completion"
slug: "bulk-status-patch-completes-v2-work"
intent: "Scenario: on a v2 project, multi-select in the dashboard sends PATCH /api/rex/items/bulk {ids:[<change id>], updates:{status:\"completed\"}}. handleBulkUpdate (packages/web/src/server/routes-rex/items.ts, handleBulkUpdate) writes the status with updateInTree through the change-layer store's withTransaction, which never calls completeV2Work. The change is marked completed but its amendments are not applied to the product layer, and no change_applied / auto_completed log is written. The single-item PATCH now routes completed through completeV2Work (task 8e5fab27); bulk does not. Reachable via the bulk status action. Pre-existing since resolveStore returned the change-layer store (PR 33), visible now. Verdict: should-fix (follow-up). Options: (a) on isChangeLayerStore, call completeV2Work per id for status completed and the store for the rest — cheap, mirrors single PATCH (recommended); (b) refuse bulk completed on v2 with 400 until PR 21 — cheaper, loses the feature."
acceptanceCriteria:
  - "PATCH /api/rex/items/bulk with status completed on a v2 change applies its amendments to the product layer (test against a copy of packages/rex/tests/fixtures/v2-tree)"
  - "Bulk status changes on a v1 project are unchanged (existing routes-rex tests pass)"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-36"
  - "web"
source: "ndx-adversarial-review"
blockedBy:
  - "aeac2c3a-8d85-4c5f-904d-a0094eb2a0e8"
---
