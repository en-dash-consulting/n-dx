---
id: "3e4e102f-13ba-4281-a006-f009409787f0"
level: "feature"
title: "Run Loop Cancellation and Iteration Visibility Refinements"
status: "completed"
source: "smart-add"
startedAt: "2026-04-29T18:21:35.836Z"
completedAt: "2026-04-29T18:21:35.836Z"
endedAt: "2026-04-29T18:21:35.836Z"
acceptanceCriteria: []
description: "Two coordinated UX improvements for hench's iterative run loop: (1) make Ctrl+C non-destructive while the rollback confirmation prompt is open by requiring a second Ctrl+C to actually exit, preventing accidental termination of an in-flight rollback decision; and (2) print a clear iteration banner between loop cycles so users can see progress when running with --iterations or --loop modes."
---

# Run Loop Cancellation and Iteration Visibility Refinements

 [completed]

## Summary

Two coordinated UX improvements for hench's iterative run loop: (1) make Ctrl+C non-destructive while the rollback confirmation prompt is open by requiring a second Ctrl+C to actually exit, preventing accidental termination of an in-flight rollback decision; and (2) print a clear iteration banner between loop cycles so users can see progress when running with --iterations or --loop modes.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Hold first Ctrl+C during rollback prompt and require second Ctrl+C to exit | task | completed | 2026-04-29 |
| Print '=== Iteration n/total ===' banner between hench run loop iterations | task | completed | 2026-04-29 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-29T18:21:35.836Z
- **Completed:** 2026-04-29T18:21:35.836Z
- **Duration:** < 1m
