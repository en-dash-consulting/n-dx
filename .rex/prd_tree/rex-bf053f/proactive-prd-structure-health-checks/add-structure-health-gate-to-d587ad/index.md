---
id: "d587adc9-56f3-4141-8ec8-4b0483758741"
level: "task"
title: "Add structure health gate to rex ci / ndx ci"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "ci"
blockedBy:
  - "bf1fd080-e3f7-4af9-8ee3-1626df8da8d7"
startedAt: "2026-03-24T20:09:27.518Z"
completedAt: "2026-03-24T20:09:27.518Z"
acceptanceCriteria:
  - "ndx ci fails when structure thresholds are exceeded"
  - "CI JSON output includes structure health results"
  - "Threshold violations listed with specific counts vs limits"
  - "Passes cleanly when structure is healthy"
description: "Add the structure health check as a CI gate in rex ci. When thresholds are exceeded, the CI check fails with a clear message listing which thresholds were crossed. This catches structural drift in automated pipelines."
---

# Add structure health gate to rex ci / ndx ci

🟡 [completed]

## Summary

Add the structure health check as a CI gate in rex ci. When thresholds are exceeded, the CI check fails with a clear message listing which thresholds were crossed. This catches structural drift in automated pipelines.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** rex, ci
- **Level:** task
- **Started:** 2026-03-24T20:09:27.518Z
- **Completed:** 2026-03-24T20:09:27.518Z
- **Duration:** < 1m
