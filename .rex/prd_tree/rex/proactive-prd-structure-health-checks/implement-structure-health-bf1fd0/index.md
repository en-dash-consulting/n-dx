---
id: "bf1fd080-e3f7-4af9-8ee3-1626df8da8d7"
level: "task"
title: "Implement structure health check function"
status: "completed"
priority: "high"
tags:
  - "rex"
blockedBy:
  - "6ce9b707-d96d-4133-a871-bd663e6d966c"
startedAt: "2026-03-24T19:54:48.934Z"
completedAt: "2026-03-24T19:58:49.982Z"
acceptanceCriteria:
  - "Function takes PRD items + thresholds, returns warnings array"
  - "Checks: epic count, max depth, oversized containers, undersized containers"
  - "Each warning includes what threshold was crossed and suggested fix"
  - "Unit tests cover each threshold type"
description: "Create a core/structure-health.ts function that evaluates the PRD tree against the configured thresholds. Returns a list of warnings (not errors) with severity and suggested action. Reuses metrics from the existing health command but adds threshold comparison."
---

# Implement structure health check function

🟠 [completed]

## Summary

Create a core/structure-health.ts function that evaluates the PRD tree against the configured thresholds. Returns a list of warnings (not errors) with severity and suggested action. Reuses metrics from the existing health command but adds threshold comparison.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** rex
- **Level:** task
- **Started:** 2026-03-24T19:54:48.934Z
- **Completed:** 2026-03-24T19:58:49.982Z
- **Duration:** 4m
