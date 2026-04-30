---
id: "caadeba9-0971-4a34-b088-63c4e76d8a6b"
level: "task"
title: "Emit actionable diagnostics when Claude CLI cannot be located"
status: "completed"
priority: "high"
tags:
  - "init"
  - "error-handling"
  - "ux"
source: "smart-add"
startedAt: "2026-04-10T16:00:14.790Z"
completedAt: "2026-04-10T16:14:21.791Z"
acceptanceCriteria:
  - "Error output lists every path that was checked, in order, so the user can diagnose their own environment"
  - "Platform-specific install command is suggested (e.g. 'brew install claude' on macOS, 'npm install -g claude' otherwise)"
  - "ndx init exits with a non-zero code and a human-readable message rather than an uncaught exception"
  - "Running ndx init with CLAUDE_CLI_PATH pointing to a nonexistent file produces the same structured error"
  - "Integration test verifies the error message contains both the searched paths and an install hint"
description: "When all discovery attempts fail, ndx init should print a clear, structured error that tells the user exactly which paths were searched and provides install instructions specific to the detected platform (Homebrew for macOS, npm global for Linux/Windows, and a link to the Claude desktop download). The error must not expose an unhandled exception or stack trace."
---

# Emit actionable diagnostics when Claude CLI cannot be located

🟠 [completed]

## Summary

When all discovery attempts fail, ndx init should print a clear, structured error that tells the user exactly which paths were searched and provides install instructions specific to the detected platform (Homebrew for macOS, npm global for Linux/Windows, and a link to the Claude desktop download). The error must not expose an unhandled exception or stack trace.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** init, error-handling, ux
- **Level:** task
- **Started:** 2026-04-10T16:00:14.790Z
- **Completed:** 2026-04-10T16:14:21.791Z
- **Duration:** 14m
