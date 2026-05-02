---
id: "211f95af-1dba-486c-bd90-538e9a199be8"
level: "task"
title: "Fix structural in global: Both rex fix zones fall at or below the dual-fragility threshold simultaneously; (+3 more)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-18T15:15:58.986Z"
completedAt: "2026-04-18T15:26:10.910Z"
resolutionType: "config-override"
resolutionDetail: "Updated CLAUDE.md dual-fragility governance table: consolidated rex-satellite zones, added sourcevision-view-layer, formalized 74-edge regression threshold."
acceptanceCriteria: []
description: "- Both rex fix zones fall at or below the dual-fragility threshold simultaneously; per the rex-satellite zone policy, treating them as a single satellite zone with subdirectory conventions would consolidate governance and reduce zone count without losing boundary visibility\n- The web ↔ web-viewer bidirectional coupling (74 total cross-zone imports) is the single highest-risk structural relationship in the codebase; it should be tracked as a metric with a regression threshold to prevent further growth.\n- sourcevision-view-layer is the only zone in this batch meeting the dual-fragility criteria (cohesion < 0.4 AND coupling > 0.6); it should be added to the CLAUDE.md dual-fragility governance table.\n- viewer-ui-hub (cohesion 0.38, coupling 0.63) meets both dual-fragility thresholds and should be added to the CLAUDE.md fragility governance table alongside web-shared and rex-cli to make its baseline explicit and enable regression tracking."
recommendationMeta: "[object Object]"
---

# Fix structural in global: Both rex fix zones fall at or below the dual-fragility threshold simultaneously; (+3 more)

🟠 [completed]

## Summary

- Both rex fix zones fall at or below the dual-fragility threshold simultaneously; per the rex-satellite zone policy, treating them as a single satellite zone with subdirectory conventions would consolidate governance and reduce zone count without losing boundary visibility
- The web ↔ web-viewer bidirectional coupling (74 total cross-zone imports) is the single highest-risk structural relationship in the codebase; it should be tracked as a metric with a regression threshold to prevent further growth.
- sourcevision-view-layer is the only zone in this batch meeting the dual-fragility criteria (cohesion < 0.4 AND coupling > 0.6); it should be added to the CLAUDE.md dual-fragility governance table.
- viewer-ui-hub (cohesion 0.38, coupling 0.63) meets both dual-fragility thresholds and should be added to the CLAUDE.md fragility governance table alongside web-shared and rex-cli to make its baseline explicit and enable regression tracking.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-18T15:15:58.986Z
- **Completed:** 2026-04-18T15:26:10.910Z
- **Duration:** 10m
