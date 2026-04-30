---
id: "3415b5f0-3496-4813-8cc9-9f571044d49c"
level: "feature"
title: "Run Failure Recovery and Rollback"
status: "completed"
source: "smart-add"
startedAt: "2026-04-16T15:21:00.385Z"
completedAt: "2026-04-16T15:21:00.385Z"
acceptanceCriteria: []
description: "When an ndx work run fails, automatically revert uncommitted file changes and reset the PRD task status back to pending so the user can retry without manual cleanup."
---

# Run Failure Recovery and Rollback

 [completed]

## Summary

When an ndx work run fails, automatically revert uncommitted file changes and reset the PRD task status back to pending so the user can retry without manual cleanup.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add regression tests for Codex multi-line 'tokens used' output format | task | completed | 2026-04-16 |
| Add rollback configuration, confirmation UX, and regression tests | task | completed | 2026-04-20 |
| Implement git change rollback on failed hench runs | task | completed | 2026-04-16 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-16T15:21:00.385Z
- **Completed:** 2026-04-16T15:21:00.385Z
- **Duration:** < 1m
