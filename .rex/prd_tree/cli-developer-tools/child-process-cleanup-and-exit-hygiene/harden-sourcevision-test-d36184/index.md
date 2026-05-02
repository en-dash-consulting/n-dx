---
id: "d3618484-b8ab-4ed5-a162-7602873aa162"
level: "task"
title: "Harden SourceVision test execution against lingering workers and orphaned threads"
status: "completed"
priority: "critical"
tags:
  - "sourcevision"
  - "tests"
  - "threads"
  - "process-management"
source: "smart-add"
startedAt: "2026-04-03T13:48:52.972Z"
completedAt: "2026-04-03T13:53:35.580Z"
acceptanceCriteria:
  - "SourceVision test-related subprocesses or workers are routed through the shared cleanup mechanism instead of unmanaged direct spawns"
  - "Known long-running or watch-like test helpers used by SourceVision are explicitly shut down when the parent workflow completes"
  - "No orphaned SourceVision-related child process remains after a representative test workflow finishes in a regression scenario"
  - "Failure paths during SourceVision test execution still trigger cleanup of already-started workers or subprocesses"
description: "Audit the SourceVision test/runtime paths that can continue running after completion and make them participate in the same shutdown contract so nonstop unit-test activity does not linger on developer machines."
---

# Harden SourceVision test execution against lingering workers and orphaned threads

🔴 [completed]

## Summary

Audit the SourceVision test/runtime paths that can continue running after completion and make them participate in the same shutdown contract so nonstop unit-test activity does not linger on developer machines.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** sourcevision, tests, threads, process-management
- **Level:** task
- **Started:** 2026-04-03T13:48:52.972Z
- **Completed:** 2026-04-03T13:53:35.580Z
- **Duration:** 4m
