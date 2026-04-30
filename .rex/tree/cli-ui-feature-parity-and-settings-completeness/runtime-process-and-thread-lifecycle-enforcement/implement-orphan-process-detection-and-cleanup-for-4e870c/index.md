---
id: "4e870c51-cd43-47a2-89f2-02e8e4f3ce57"
level: "task"
title: "Implement orphan process detection and cleanup for spawned subcommands"
status: "completed"
priority: "high"
tags:
  - "process-lifecycle"
  - "cli"
  - "reliability"
source: "smart-add"
startedAt: "2026-04-03T18:42:52.392Z"
completedAt: "2026-04-03T18:50:24.323Z"
acceptanceCriteria:
  - "All child processes are registered in a process registry at spawn time"
  - "On parent exit (clean, SIGINT, or unhandled exception), all registered children are sent SIGTERM then SIGKILL after a grace period"
  - "A test simulates a mid-run SIGINT and confirms no orphan processes remain after 5 seconds"
  - "The registry is a no-op in environments where process groups are not supported (Windows CI) — no crash, just a warning log"
description: "Add a process-group-aware cleanup layer so that any child processes spawned during a CLI run (e.g., sourcevision analyze, hench run) are tracked and forcibly reaped if they outlive their parent command. Extend the existing graceful shutdown to cover abnormal termination paths."
---

# Implement orphan process detection and cleanup for spawned subcommands

🟠 [completed]

## Summary

Add a process-group-aware cleanup layer so that any child processes spawned during a CLI run (e.g., sourcevision analyze, hench run) are tracked and forcibly reaped if they outlive their parent command. Extend the existing graceful shutdown to cover abnormal termination paths.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** process-lifecycle, cli, reliability
- **Level:** task
- **Started:** 2026-04-03T18:42:52.392Z
- **Completed:** 2026-04-03T18:50:24.323Z
- **Duration:** 7m
