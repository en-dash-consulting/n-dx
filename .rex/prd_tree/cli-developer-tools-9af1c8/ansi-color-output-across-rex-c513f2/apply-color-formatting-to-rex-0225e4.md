---
id: "0225e4e7-659e-40f3-917d-ee6b81515379"
level: "task"
title: "Apply color formatting to rex CLI output"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "cli"
  - "color"
source: "smart-add"
startedAt: "2026-04-08T19:06:05.882Z"
completedAt: "2026-04-08T19:13:22.896Z"
acceptanceCriteria:
  - "rex status tree renders completed items in a distinct success/dim color and pending items in a neutral color"
  - "rex next output highlights the selected task title and its priority level with semantic colors"
  - "rex validate renders error-level findings in red, warning-level in yellow, and passing checks in green"
  - "rex add proposal review renders accept/skip/reject options with distinct colors"
  - "rex --format=json output contains no ANSI escape codes"
  - "rex --quiet output contains no ANSI escape codes"
  - "Colors are suppressed when stdout is not a TTY (e.g. piped to file)"
description: "Wire the shared color utility into rex command output so that status trees, next-task selection, validate results, and add/proposal feedback use semantic colors. Completed items should render dimmed or in a success color; pending items in neutral or highlight color; errors and validation failures in red; warnings in yellow. Output from --format=json and --quiet flags must remain unaffected."
---
