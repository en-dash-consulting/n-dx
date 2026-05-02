---
id: "be167d08-8687-4ad6-a8cd-aeb929f8d838"
level: "task"
title: "Apply color formatting to hench and ndx orchestrator output"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "ndx"
  - "cli"
  - "color"
source: "smart-add"
startedAt: "2026-04-08T18:45:56.232Z"
completedAt: "2026-04-08T18:59:19.653Z"
acceptanceCriteria:
  - "hench run start banner and task title render in a highlighted color"
  - "Per-iteration status lines (in_progress, completed, failed) use semantic colors matching the shared palette"
  - "hench run summary shows completed task count in green and failed count in red"
  - "ndx orchestration commands emit colored section headers that visually separate package output"
  - "Errors and failures across all ndx commands render in red with the error message clearly distinct from surrounding output"
  - "hench --quiet and --format=json suppress all ANSI codes"
  - "ndx color output is suppressed when stdout is not a TTY"
description: "Wire the shared color utility into hench run-loop output and the ndx orchestrator so that task selection headers, run status updates, completion summaries, and multi-package orchestration output are color-coded. Hench run start/end banners, per-iteration task labels, and error/timeout notices should each have distinct colors. ndx orchestration commands (plan, work, ci, status) should emit colored section headers and outcome lines."
---

# Apply color formatting to hench and ndx orchestrator output

🟠 [completed]

## Summary

Wire the shared color utility into hench run-loop output and the ndx orchestrator so that task selection headers, run status updates, completion summaries, and multi-package orchestration output are color-coded. Hench run start/end banners, per-iteration task labels, and error/timeout notices should each have distinct colors. ndx orchestration commands (plan, work, ci, status) should emit colored section headers and outcome lines.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** hench, ndx, cli, color
- **Level:** task
- **Started:** 2026-04-08T18:45:56.232Z
- **Completed:** 2026-04-08T18:59:19.653Z
- **Duration:** 13m
