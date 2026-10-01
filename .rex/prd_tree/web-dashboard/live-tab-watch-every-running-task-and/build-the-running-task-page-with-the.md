---
id: "8050220c-7add-4547-8806-0fc6765acb82"
level: "task"
title: "Build the running-task page with the Work tab: step stream, criteria, runs, location and spend"
status: "pending"
priority: "high"
tags:
  - "live"
  - "web-viewer"
blockedBy:
  - "b1dd0bde-32a5-418c-a046-917e7d407181"
  - "ee6d1469-e731-4c4e-868b-ba2684c11c46"
  - "dfb31a58-442b-4ee2-bbff-d2b0b0e58419"
acceptanceCriteria:
  - "The Work tab shows each progress event within 1 second of it being written and keeps the current step in view while following."
  - "Opening the page for a run in another worktree works from the overview, the peek and the running-now bar, and shows the workspace strip."
  - "Stop works for dashboard- and terminal-started runs and asks for confirmation; Mark stuck uses the existing route."
  - "The run picker switches between runs of the task without a reload; the URL records the selected run."
  - "A run recorded before the event stream existed shows its heartbeat counters and a 'step detail unavailable for this run' note instead of an empty tab."
description: "New view at `/live/task/:taskId`, defaulting to the task's current run, with a run picker when it has several. A task in another worktree is opened under `/w/<key>/live/task/:taskId` and shows the existing one-line strip naming the non-anchor workspace. Header: route, run n of m, task title, chips (running and elapsed, epic chain, priority, turn of max turns, tokens and tokens per second, vendor model and weight, heartbeat age), actions Copy link, Mark stuck and Stop (existing terminate route; for terminal-started runs, stop by the recorded pid). Main card has tabs Work, Log and Review (Review only when the run has `--review`). Work tab: the progress event stream rendered one line per step with time, status dot and a muted detail line, the current step highlighted, then a five-line log tail linking to the Log tab. Side column: task description and acceptance criteria with met/unmet state, runs of this task (current highlighted, earlier ones with outcome and a View link), where it runs (worktree path, branch, start commit, files changed so far, pid and whether it was started from the dashboard or a terminal), spend so far (input, output, cache read, cost) and what happens after the run (gates, review). When the run finishes, the page says so and links to Work's run detail."
lastModified: "2026-10-01T00:21:17.715Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
