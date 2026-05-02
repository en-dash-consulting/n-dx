---
id: "eb21a965-6d17-4ee7-b6bd-0f1e6d07ff33"
level: "feature"
title: "ANSI Color Reset Consistency in Tool Output"
status: "completed"
source: "smart-add"
startedAt: "2026-04-09T18:32:06.317Z"
completedAt: "2026-04-09T18:32:06.317Z"
acceptanceCriteria: []
description: "Tool output lines using blue (and potentially other) ANSI colors do not emit a reset code at the end of the line, causing the color to bleed into subsequent terminal output. This is a correctness issue in the color formatting layer — every colorized segment must close with a reset so downstream text renders in the default terminal color."
---

# ANSI Color Reset Consistency in Tool Output

 [completed]

## Summary

Tool output lines using blue (and potentially other) ANSI colors do not emit a reset code at the end of the line, causing the color to bleed into subsequent terminal output. This is a correctness issue in the color formatting layer — every colorized segment must close with a reset so downstream text renders in the default terminal color.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add regression tests for ANSI color reset and line-boundary consistency | task | completed | 2026-04-09 |
| Audit and fix missing ANSI reset codes in tool and CLI output lines | task | completed | 2026-04-09 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-09T18:32:06.317Z
- **Completed:** 2026-04-09T18:32:06.317Z
- **Duration:** < 1m
