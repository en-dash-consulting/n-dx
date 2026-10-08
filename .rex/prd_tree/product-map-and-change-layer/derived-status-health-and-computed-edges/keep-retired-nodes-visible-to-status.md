---
id: "578265ae-aaa1-4f21-a239-941b49ccd9d8"
level: "task"
title: "Keep retired nodes visible to status, kind and edges"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "Pre-freeze review finding 2 (2026-10-07, Ryan). Apply retires a node by setting status deleted, and indexTree skips deleted nodes, so after a real apply the node has no row in computeProductStatus, retired is never reported, and an earlier change that modified a since-retired constraint flips kind from policy change to enhancement, losing its changedBy and realizedBy history. Runs after PR 30 is merged into this branch (it adds indexTree's includeTombstones option).\n\n- Retired = a product node that is deleted and that an applied change (appliedAt set) removed. computeProductStatus reports it with intent retired.\n- deriveChangeKind, computeEdges and alias lookup resolve against the tombstone-aware index, so a change's kind and history do not change after a later retirement.\n- Fix the fixtures: the current product-status fixture keeps the retired node live, which apply never produces; use a deleted node removed by an applied change.\nTests for each point."
lastModified: "2026-10-08T00:04:20.857Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
