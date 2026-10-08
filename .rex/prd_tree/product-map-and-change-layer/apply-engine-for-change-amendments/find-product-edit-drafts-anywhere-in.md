---
id: "6a3e5fc7-9b67-42af-ad72-14754e0d3791"
level: "task"
title: "Find product-edit drafts anywhere in the change tree, and store applied amendment targets by node id"
status: "pending"
priority: "high"
description: "Two P2 findings from the review of PR #583 (inline comments 4215573116 and 4215573122), both reproduced by the reviewer. Do both.\n\n1. Nested drafts (packages/rex/src/core/product-edit.ts, drafts()). The scan only looks at root changes (for change of tree.changes), but changes can nest. A pending source: product-edit draft under another change is not refreshed, not reported as stale, and a revert returns 'reverted' while the nested draft stays pending with its abandoned amendment. Walk the live change tree recursively, skipping deleted subtrees, so refresh, withdrawal and stale reporting cover nested drafts. Regression: draft A->B, nest it under an umbrella change, revert B->A: the nested draft is withdrawn.\n2. Stable targets (packages/rex/src/core/apply-amendments.ts). Apply returns the resolved node.id in applied, but the stored change keeps the amendment's original target, which may be a display id. After a removal targeting A1.1, renumbering another capability to A1.1 (allowed by ref-unique) makes the stored removal point at the new node, so derived readers (retired status, changedBy) rewrite history. When applying, rewrite each amendment's target (and an added amendment's under) to the resolved node id before computing appliedAmendsHash. Regression: apply a removal by display id, renumber another node to that display id, and the applied change still names the retired node.\n\nTests for both. Stay in core/product-edit.ts, core/apply-amendments.ts and their tests; commit the work."
lastModified: "2026-10-08T06:28:54.756Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
