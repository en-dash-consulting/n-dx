---
id: "a1062845-51ec-48be-b909-54d0a549f6cd"
level: "feature"
title: "Fix Inaccurate File-Change Reporting in Run Summary and Dashboard"
status: "completed"
source: "smart-add"
startedAt: "2026-04-30T20:43:45.405Z"
completedAt: "2026-04-30T20:43:45.405Z"
endedAt: "2026-04-30T20:43:45.405Z"
acceptanceCriteria: []
description: "The run summary and dashboard are reporting zero changed files for runs whose commits demonstrably touched files. This breaks the change-classification gate above, the dashboard's per-run change column, and operator trust in run telemetry. The fault is in how the run records changed-file evidence (likely a stale or wrong-cwd git diff capture, or a captured snapshot taken before the commit) rather than in the commit itself."
---

# Fix Inaccurate File-Change Reporting in Run Summary and Dashboard

 [completed]

## Summary

The run summary and dashboard are reporting zero changed files for runs whose commits demonstrably touched files. This breaks the change-classification gate above, the dashboard's per-run change column, and operator trust in run telemetry. The fault is in how the run records changed-file evidence (likely a stale or wrong-cwd git diff capture, or a captured snapshot taken before the commit) rather than in the commit itself.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Diagnose and fix changed-file capture so run records reflect actual commit diffs | task | completed | 2026-04-30 |
| Render accurate changed-file counts and details in dashboard run summary | task | completed | 2026-04-30 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-30T20:43:45.405Z
- **Completed:** 2026-04-30T20:43:45.405Z
- **Duration:** < 1m
