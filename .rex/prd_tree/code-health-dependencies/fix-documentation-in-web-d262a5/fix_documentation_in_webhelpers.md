---
id: "d262a54e-0a71-4580-b100-9f7c7e265699"
level: "task"
title: "Fix documentation in web-helpers: Zone name 'web-helpers' is misleading for a single-component zone — it invites s (+1 more)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:59:30.427Z"
completedAt: "2026-04-14T02:03:25.961Z"
acceptanceCriteria: []
description: "- Zone name 'web-helpers' is misleading for a single-component zone — it invites scope creep by suggesting a general utility bucket rather than a bounded component zone, and may attract future additions that bypass the two-consumer rule check.\n- Add a 'confirmed zone-level cycles' section to CLAUDE.md's architectural governance table, separate from the metric-based dual-fragility table. The only true cycle in the monorepo is more dangerous than all metric-triggered zones yet is invisible to threshold-based governance because web-helpers has cohesion 1 and coupling 0."
__parentAcceptanceCriteria: []
__parentCompletedAt: "2026-04-14T02:03:26.140Z"
__parentDescription: "- Zone name 'web-helpers' is misleading for a single-component zone — it invites scope creep by suggesting a general utility bucket rather than a bounded component zone, and may attract future additions that bypass the two-consumer rule check.\n- Add a 'confirmed zone-level cycles' section to CLAUDE.md's architectural governance table, separate from the metric-based dual-fragility table. The only true cycle in the monorepo is more dangerous than all metric-triggered zones yet is invisible to threshold-based governance because web-helpers has cohesion 1 and coupling 0."
__parentId: "9df71711-8089-4ba1-8933-725aa23ccfdc"
__parentLevel: "feature"
__parentPriority: "high"
__parentRecommendationMeta: "[object Object]"
__parentSource: "sourcevision"
__parentStartedAt: "2026-04-14T02:03:26.140Z"
__parentStatus: "completed"
__parentTitle: "Fix documentation in web-helpers (2 findings)"
recommendationMeta: "[object Object]"
---
