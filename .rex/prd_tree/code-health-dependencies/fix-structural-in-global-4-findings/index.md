---
id: "d3b0080a-4418-44e8-a838-2aaef97bf36b"
level: "feature"
title: "Fix structural in global (4 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-18T15:26:10.947Z"
completedAt: "2026-04-18T15:26:10.947Z"
acceptanceCriteria: []
description: "- Both rex fix zones fall at or below the dual-fragility threshold simultaneously; per the rex-satellite zone policy, treating them as a single satellite zone with subdirectory conventions would consolidate governance and reduce zone count without losing boundary visibility\n- The web ↔ web-viewer bidirectional coupling (74 total cross-zone imports) is the single highest-risk structural relationship in the codebase; it should be tracked as a metric with a regression threshold to prevent further growth.\n- sourcevision-view-layer is the only zone in this batch meeting the dual-fragility criteria (cohesion < 0.4 AND coupling > 0.6); it should be added to the CLAUDE.md dual-fragility governance table.\n- viewer-ui-hub (cohesion 0.38, coupling 0.63) meets both dual-fragility thresholds and should be added to the CLAUDE.md fragility governance table alongside web-shared and rex-cli to make its baseline explicit and enable regression tracking."
recommendationMeta: "[object Object]"
---

# Fix structural in global (4 findings)

🟠 [completed]

## Summary

- Both rex fix zones fall at or below the dual-fragility threshold simultaneously; per the rex-satellite zone policy, treating them as a single satellite zone with subdirectory conventions would consolidate governance and reduce zone count without losing boundary visibility
- The web ↔ web-viewer bidirectional coupling (74 total cross-zone imports) is the single highest-risk structural relationship in the codebase; it should be tracked as a metric with a regression threshold to prevent further growth.
- sourcevision-view-layer is the only zone in this batch meeting the dual-fragility criteria (cohesion < 0.4 AND coupling > 0.6); it should be added to the CLAUDE.md dual-fragility governance table.
- viewer-ui-hub (cohesion 0.38, coupling 0.63) meets both dual-fragility thresholds and should be added to the CLAUDE.md fragility governance table alongside web-shared and rex-cli to make its baseline explicit and enable regression tracking.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Fix structural in global: Both rex fix zones fall at or below the dual-fragility threshold simultaneously; (+3 more) | task | completed | 2026-04-18 |

## Info

- **Status:** completed
- **Priority:** high
- **Level:** feature
- **Started:** 2026-04-18T15:26:10.947Z
- **Completed:** 2026-04-18T15:26:10.947Z
- **Duration:** < 1m
