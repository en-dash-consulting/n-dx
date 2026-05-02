---
id: "f0294876-d42d-497e-a3c6-c5abf7a374ed"
level: "feature"
title: "Proactive PRD structure health checks"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "quality"
blockedBy:
  - "9fa85475-a6ff-474a-bf4f-e1f531df7916"
startedAt: "2026-03-24T20:09:27.664Z"
completedAt: "2026-03-24T20:09:27.664Z"
acceptanceCriteria:
  - "rex add/analyze/plan warns when top-level epic count exceeds a configurable threshold (default: 15)"
  - "rex ci includes a structure health gate that fails when epic count, max depth, or avg children-per-container is out of bounds"
  - "Warnings suggest running /ndx-reshape or rex reorganize"
  - "Thresholds are configurable in .rex/config.json"
description: "The PRD grew to 70 top-level epics before anyone noticed the structure had degraded. The current `reorganize` command is reactive — it finds problems after they exist. Rex should proactively warn during writes (add, analyze, plan) when structural thresholds are crossed, so the PRD stays organized as it grows rather than requiring periodic manual cleanup."
---

# Proactive PRD structure health checks

🟡 [completed]

## Summary

The PRD grew to 70 top-level epics before anyone noticed the structure had degraded. The current `reorganize` command is reactive — it finds problems after they exist. Rex should proactively warn during writes (add, analyze, plan) when structural thresholds are crossed, so the PRD stays organized as it grows rather than requiring periodic manual cleanup.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add structure health gate to rex ci / ndx ci | task | completed | 2026-03-24 |
| Define structure health thresholds and add to rex config schema | task | completed | 2026-03-24 |
| Implement structure health check function | task | completed | 2026-03-24 |
| Wire health warnings into rex add, analyze, and plan write paths | task | completed | 2026-03-24 |

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** rex, quality
- **Level:** feature
- **Started:** 2026-03-24T20:09:27.664Z
- **Completed:** 2026-03-24T20:09:27.664Z
- **Duration:** < 1m
