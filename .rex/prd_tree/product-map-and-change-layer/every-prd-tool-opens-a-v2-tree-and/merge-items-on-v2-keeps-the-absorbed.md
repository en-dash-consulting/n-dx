---
id: "3ba2a3ca-edc4-42cb-9a08-bfd833d721bf"
level: "task"
title: "merge_items on v2 keeps the absorbed change's id, display id and aliases as aliases on the target"
status: "pending"
priority: "medium"
tags:
  - "pr-33"
  - "review-2026-10-12"
  - "lane-rex-store"
source: "review-2026-10-12"
acceptanceCriteria:
  - "After merge_items absorbs a change on a v2 copy, the target's aliases hold the absorbed change's id, displayId and former aliases, deduplicated (test that fails on 91865a3c2a)"
  - "get_item with the absorbed change's old id resolves to the target after the merge (test)"
  - "The v1 merge is unchanged; existing merge tests pass unedited"
  - ".changeset/rex-v2-store-resolution.md gains a soft-freeze line for the aliases merge_items now records on v2"
description: "Review 2026-10-12, PR #687 should-fix (CONFIRMED for the dropped id; the downstream attribution effect is traced, not run).\n\nDefect: packages/rex/src/cli/mcp-tools/merge-items.ts:51 and core/merge.ts (carryTouches carries `touches` only) discard the absorbed change's id, its displayId and its aliases. The v2 schema defines `aliases` as \"Former ids (folded items, renumbered display ids) that still resolve here\" (schema/v2.ts:302), and schema/v2-rules.ts:116 says \"a folded id kept as an alias resolves to the live node\".\n\nFailure scenario (reproduced): merge \"Tidy the card form\" into CH-1. The target's index.md gains no `aliases`. trailerIds (core/product-edges.ts:181) uses aliases to attribute N-DX-Item commits to a change, so after the merge commits that name the absorbed change no longer count toward the target's landing, shippedIn or realized-by, and get_item(\"<old id or CH-n>\") stops resolving.\n\nFix: in the v2 branch of the merge, push each absorbed change's id, displayId and existing aliases onto the target's aliases (deduplicated, never the target's own id or displayId), next to carryTouches. Add a soft-freeze line to .changeset/rex-v2-store-resolution.md: on a v2 tree merge_items records the absorbed changes' ids and display ids as `aliases` on the target (the target item's `aliases` field, optional, absent on v1)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T18:13:20.199Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
