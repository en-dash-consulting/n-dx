---
id: "598d6fd3-86d0-42d2-8a41-1030963777ef"
level: "task"
title: "Smart Add Command Regression Fix"
status: "completed"
source: "smart-add"
startedAt: "2026-03-06T16:45:34.740Z"
completedAt: "2026-03-19T15:03:54.710Z"
resolutionType: "acknowledgment"
resolutionDetail: "All children completed; pending tasks moved to new CLI epic"
acceptanceCriteria: []
description: "The `ndx add` orchestration command currently throws a 'missing .rex' error instead of delegating to `rex add` as expected. The fix should ensure `ndx add` spawns the rex CLI with the correct arguments and working directory, matching the behavior documented in CLAUDE.md."
---

# Smart Add Command Regression Fix

 [completed]

## Summary

The `ndx add` orchestration command currently throws a 'missing .rex' error instead of delegating to `rex add` as expected. The fix should ensure `ndx add` spawns the rex CLI with the correct arguments and working directory, matching the behavior documented in CLAUDE.md.

## Info

- **Status:** completed
- **Level:** task
- **Started:** 2026-03-06T16:45:34.740Z
- **Completed:** 2026-03-19T15:03:54.710Z
- **Duration:** 12d 22h 18m
