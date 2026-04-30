---
id: "d8f5d40d-a68f-4da7-8c97-63e5513ff034"
level: "task"
title: "Implement default long timeout with per-command override support"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "timeout"
  - "config"
source: "smart-add"
startedAt: "2026-04-03T18:50:27.384Z"
completedAt: "2026-04-03T18:58:23.179Z"
acceptanceCriteria:
  - "All CLI commands respect a `cli.timeoutMs` config key; default is 1800000ms (30 minutes)"
  - "When a command exceeds its timeout, it exits with a non-zero code and prints a clear message naming the command and elapsed time"
  - "Per-command overrides (`cli.timeouts.analyze`, `cli.timeouts.work`, etc.) take precedence over the global default"
  - "A unit test verifies timeout enforcement fires at the configured threshold using a mock timer"
description: "Add a timeout enforcement layer around the main execution path of each CLI command. The default timeout should be long enough for real workloads (e.g., 30 minutes) but terminate and surface an actionable error if exceeded. Support per-command overrides so commands like `ndx work` can use a different threshold than `ndx analyze`."
parentId: "0fb7be48-74a2-495d-a184-dced4d6d2d87"
---

# Implement default long timeout with per-command override support

🟠 [completed]

## Summary

Add a timeout enforcement layer around the main execution path of each CLI command. The default timeout should be long enough for real workloads (e.g., 30 minutes) but terminate and surface an actionable error if exceeded. Support per-command overrides so commands like `ndx work` can use a different threshold than `ndx analyze`.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** cli, timeout, config
- **Level:** task
- **Started:** 2026-04-03T18:50:27.384Z
- **Completed:** 2026-04-03T18:58:23.179Z
- **Duration:** 7m
