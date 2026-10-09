---
id: "5f593767-a7bc-4801-a90a-b01cef818aa6"
level: "task"
title: "A product reshape merge removes merged capabilities without carrying their requirements, dependsOn, tags or body, and leaves dependents naming a retired node"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-18"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A merge of a capability with requirements, dependsOn, tags or a non-History body is skipped with the reason (test)"
  - "A merge of a capability another live node names in dependsOn or appliesTo is skipped with the reason (test)"
  - "A merge of capabilities with none of these still drafts the change as today (test)"
description: "Verdict: out-of-scope for 25a733b4, which fixed reparent and split only. Found reviewing it; pre-existing in the merge branch.\n\nScenario: draftProductReshape's merge case (packages/rex/src/core/product-reshape.ts, `case \"merge\"`) drafts a `removed` amendment for each merged node and a `modified` amendment for the survivor. The modified amendment carries only the merged nodes' capability criteria and an optional statement. Suppose cap2 has requirements, dependsOn, tags or a body, or cap3 has `dependsOn: [cap2]`, and cap2 is merged into cap1. Applying the change retires cap2. Its requirements no longer count toward the survivor, its dependsOn is gone, and cap3's dependsOn now names a retired node. The draft reads as a lossless merge.\n\nReachable: `rex reshape --accept` with a merge proposal on a v2 tree, then `rex change apply`.\n\nOptions:\n(1) Skip the merge, with the reason, when a merged node has requirements, dependsOn, tags or a non-History body, or another live node names it. Reuse cannotCopy's checks from 25a733b4. Cheap.\n(2) Let a modified amendment add requirements and dependsOn to the survivor, and re-point dependents (apply-engine and schema decision).\nRecommend (1) now.\n\nDecided (Ryan, 2026-10-09): option 1. Skip the merge, with the reason, when a merged node has requirements, dependsOn, tags or a non-History body, or another live node names it; reuse cannotCopy's checks from 25a733b4 (with 1413100d's History-only rule). Carrying data to the survivor (option 2) is not in scope."
lastModified: "2026-10-09T14:37:05.669Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
