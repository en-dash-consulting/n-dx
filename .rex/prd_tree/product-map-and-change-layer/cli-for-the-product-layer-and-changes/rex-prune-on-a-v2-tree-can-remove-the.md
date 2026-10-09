---
id: "68cc9f9b-104a-45d4-bd3a-2a139c97e6ec"
level: "task"
title: "rex prune on a v2 tree can remove the applied change that marks a product node retired"
status: "pending"
priority: "medium"
tags:
  - "pr-18"
  - "lane-rex-surface"
  - "rex"
acceptanceCriteria:
  - "rex prune on a v2 tree never removes the only applied change that retires a product node (test)"
  - "rex product show reports such a node as retired after a prune (test)"
description: "Found while making prune layer-aware (91461587). On a v2 tree prune removes fully completed change subtrees, as on v1. core/product-status.ts reads a node as \"retired\" only while an applied change with a removed amendment for it exists, so pruning that change leaves a deleted product node with no status row. No v2 rule flags it, so the ChangeLayerStore's new-error check does not refuse it. Decide: keep applied changes that carry removed or added amendments out of prune, or archive them in a form product-status still reads.\n\nDecided (Ryan, 2026-10-09): keep applied changes that carry removed or added amendments out of prune on a v2 tree (prune reports them as kept, with the reason). No new archive format."
lastModified: "2026-10-09T14:37:00.981Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
