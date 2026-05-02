---
id: "55d8280d-4b05-4109-99da-f803b8330b1a"
level: "task"
title: "Configure explicit timeouts on identified hanging-test candidates"
status: "completed"
priority: "critical"
tags:
  - "tests"
  - "timeouts"
  - "vitest"
  - "stability"
source: "smart-add"
startedAt: "2026-04-02T16:40:48.635Z"
completedAt: "2026-04-02T16:45:50.275Z"
acceptanceCriteria:
  - "Every identified at-risk test or suite has an explicit timeout configured at or below 120 seconds"
  - "Timeout configuration changes are limited to test files or test-only setup files"
description: "Apply explicit timeout settings to every at-risk test or suite so that hangs fail within a bounded window of 120 seconds or less."
---

# Configure explicit timeouts on identified hanging-test candidates

🔴 [completed]

## Summary

Apply explicit timeout settings to every at-risk test or suite so that hangs fail within a bounded window of 120 seconds or less.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** tests, timeouts, vitest, stability
- **Level:** task
- **Started:** 2026-04-02T16:40:48.635Z
- **Completed:** 2026-04-02T16:45:50.275Z
- **Duration:** 5m
