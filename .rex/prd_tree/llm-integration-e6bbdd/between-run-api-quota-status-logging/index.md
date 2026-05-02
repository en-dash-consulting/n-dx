---
id: "642df761-d076-4309-bd5c-edba76604dfd"
level: "feature"
title: "Between-Run API Quota Status Logging"
status: "completed"
source: "smart-add"
startedAt: "2026-04-08T20:46:18.155Z"
completedAt: "2026-04-08T20:46:18.155Z"
acceptanceCriteria: []
description: "After each hench run completes, check remaining API quota or configured budget headroom for Claude and Codex providers and report it to the user in the run log with color-coded warnings at threshold boundaries."
---

# Between-Run API Quota Status Logging

 [completed]

## Summary

After each hench run completes, check remaining API quota or configured budget headroom for Claude and Codex providers and report it to the user in the run log with color-coded warnings at threshold boundaries.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Define typed quota result interface and identify invocation point in hench run loop | task | completed | 2026-04-08 |
| Implement ANSI color-coded quota log formatter | task | completed | 2026-04-08 |
| Implement budget-based percent-remaining calculation for active providers | task | completed | 2026-04-08 |
| Integrate quota log output into hench run console with quiet/JSON suppression | task | completed | 2026-04-08 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-08T20:46:18.155Z
- **Completed:** 2026-04-08T20:46:18.155Z
- **Duration:** < 1m
