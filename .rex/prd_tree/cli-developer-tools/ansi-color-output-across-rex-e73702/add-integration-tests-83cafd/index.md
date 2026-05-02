---
id: "83cafd67-4b87-4a64-a16f-936f0b78b775"
level: "task"
title: "Add integration tests validating TTY-aware color emission and NO_COLOR suppression across all CLI tools"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "testing"
  - "color"
source: "smart-add"
startedAt: "2026-04-08T20:46:49.195Z"
completedAt: "2026-04-08T20:57:04.128Z"
acceptanceCriteria:
  - "Tests spawn rex, sourcevision, hench, and ndx and assert ANSI escape codes are present when stdout is a TTY (or simulated TTY)"
  - "Tests assert ANSI codes are stripped when stdout is piped or when NO_COLOR=1 is set in the environment"
  - "Coverage includes at least one representative output per tool: rex status, sourcevision analyze summary, hench run summary, and ndx orchestrator log line"
  - "All tests pass in CI and are wired into the standard test suite via pnpm test"
description: "Without automated checks, color regressions (raw ANSI codes polluting piped JSON output, NO_COLOR being silently ignored, or colors absent in real TTY sessions) are invisible in CI. This task adds a test harness that spawns each CLI tool and asserts color code presence or absence based on the execution context."
---

# Add integration tests validating TTY-aware color emission and NO_COLOR suppression across all CLI tools

🟡 [completed]

## Summary

Without automated checks, color regressions (raw ANSI codes polluting piped JSON output, NO_COLOR being silently ignored, or colors absent in real TTY sessions) are invisible in CI. This task adds a test harness that spawns each CLI tool and asserts color code presence or absence based on the execution context.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** cli, testing, color
- **Level:** task
- **Started:** 2026-04-08T20:46:49.195Z
- **Completed:** 2026-04-08T20:57:04.128Z
- **Duration:** 10m
