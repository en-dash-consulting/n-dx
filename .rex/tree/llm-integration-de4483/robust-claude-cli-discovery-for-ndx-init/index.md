---
id: "6840c2dc-3dc0-4354-a07c-85c780df4ff4"
level: "feature"
title: "Robust Claude CLI Discovery for ndx init"
status: "completed"
source: "smart-add"
startedAt: "2026-04-10T16:27:02.649Z"
completedAt: "2026-04-10T16:27:02.649Z"
acceptanceCriteria: []
description: "ndx init fails to locate the claude CLI on machines where it is installed outside the shell's default PATH — common when users install via npm, Homebrew, or the Claude desktop app, or when ndx is invoked from a non-interactive shell (CI, IDE terminals) that does not source the user's profile. The discovery mechanism must work across macOS, Linux, and Windows regardless of how or where claude was installed."
---

# Robust Claude CLI Discovery for ndx init

 [completed]

## Summary

ndx init fails to locate the claude CLI on machines where it is installed outside the shell's default PATH — common when users install via npm, Homebrew, or the Claude desktop app, or when ndx is invoked from a non-interactive shell (CI, IDE terminals) that does not source the user's profile. The discovery mechanism must work across macOS, Linux, and Windows regardless of how or where claude was installed.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Emit actionable diagnostics when Claude CLI cannot be located | task | completed | 2026-04-10 |
| Implement multi-location Claude CLI discovery chain with configurable override | task | completed | 2026-04-10 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-10T16:27:02.649Z
- **Completed:** 2026-04-10T16:27:02.649Z
- **Duration:** < 1m
