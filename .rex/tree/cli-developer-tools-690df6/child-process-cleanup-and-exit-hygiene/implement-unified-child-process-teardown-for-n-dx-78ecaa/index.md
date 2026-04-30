---
id: "78ecaa15-4503-4f81-a368-355ced818762"
level: "task"
title: "Implement unified child-process teardown for n-dx command lifecycles"
status: "completed"
priority: "critical"
tags:
  - "cli"
  - "process-management"
  - "sourcevision"
  - "stability"
source: "smart-add"
startedAt: "2026-04-03T13:53:38.847Z"
completedAt: "2026-04-03T14:04:06.691Z"
acceptanceCriteria:
  - "All child processes spawned through `n-dx` orchestration are registered in a shared lifecycle tracker"
  - "When an `n-dx` command exits normally, the cleanup path sends termination to registered child processes and waits for shutdown before returning"
  - "When an `n-dx` command exits due to an error, the same cleanup path still runs and attempts termination for all tracked children"
  - "When the parent process receives `SIGINT` or `SIGTERM`, the cleanup path executes before final process exit"
  - "Processes that do not exit after a graceful termination attempt are force-killed after a bounded timeout"
description: "Add a centralized cleanup path for `n-dx` and package-level runners that tracks spawned child processes and terminates them on normal exit, error exit, and signal-driven shutdown. The goal is to prevent orphaned SourceVision test workers and related subprocesses from persisting after command completion."
---

# Implement unified child-process teardown for n-dx command lifecycles

🔴 [completed]

## Summary

Add a centralized cleanup path for `n-dx` and package-level runners that tracks spawned child processes and terminates them on normal exit, error exit, and signal-driven shutdown. The goal is to prevent orphaned SourceVision test workers and related subprocesses from persisting after command completion.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** cli, process-management, sourcevision, stability
- **Level:** task
- **Started:** 2026-04-03T13:53:38.847Z
- **Completed:** 2026-04-03T14:04:06.691Z
- **Duration:** 10m
