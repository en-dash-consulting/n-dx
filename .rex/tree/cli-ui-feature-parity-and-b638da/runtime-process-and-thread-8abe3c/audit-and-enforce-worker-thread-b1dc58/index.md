---
id: "b1dc5843-120b-4151-933c-82fdead1faf3"
level: "task"
title: "Audit and enforce worker thread cleanup across all CLI entry points"
status: "completed"
priority: "high"
tags:
  - "process-lifecycle"
  - "cli"
  - "reliability"
source: "smart-add"
startedAt: "2026-04-03T18:34:48.270Z"
completedAt: "2026-04-03T18:42:49.486Z"
acceptanceCriteria:
  - "All worker thread creation sites in orchestration scripts are catalogued"
  - "Each creation site has a corresponding explicit teardown path for success, error, and signal cases"
  - "Running `ndx analyze` and `ndx work` leaves zero lingering node threads as verified by process inspection"
  - "A new regression test verifies thread count returns to baseline after each CLI command completes"
description: "Review every spawn and worker-thread creation site in cli.js, ci.js, web.js, and config.js. Ensure all threads are explicitly joined or terminated before the parent process exits. Identify any code paths (errors, cancellations, SIGINT) where threads escape the cleanup gate."
---

# Audit and enforce worker thread cleanup across all CLI entry points

🟠 [completed]

## Summary

Review every spawn and worker-thread creation site in cli.js, ci.js, web.js, and config.js. Ensure all threads are explicitly joined or terminated before the parent process exits. Identify any code paths (errors, cancellations, SIGINT) where threads escape the cleanup gate.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** process-lifecycle, cli, reliability
- **Level:** task
- **Started:** 2026-04-03T18:34:48.270Z
- **Completed:** 2026-04-03T18:42:49.486Z
- **Duration:** 8m
