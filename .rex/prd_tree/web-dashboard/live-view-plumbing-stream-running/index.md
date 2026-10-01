---
id: "a6a5ac6a-ca47-435e-8749-91505acad43f"
level: "feature"
title: "Live view plumbing: stream running hench and analyze progress to the dashboard"
status: "pending"
priority: "high"
tags:
  - "live"
  - "hench"
  - "sourcevision"
  - "web-server"
source: "Live tab design session 2026-09-30; mockups https://claude.ai/artifact/AvLo4pyFzfs9HT2zZaCTE7"
acceptanceCriteria:
  - "A hench run started from a terminal and one started from the dashboard both produce a growing log file, a progress event stream and a pid on the run record while they run."
  - "A sourcevision analyze started from a terminal or the dashboard reports its current phase, enrichment pass and batch to the dashboard within 2 seconds of the change."
  - "One endpoint lists every running hench run and long job across the repository's worktrees, with the same 5-minute stale rule the bottom bar uses today."
  - "Run records, manifests and run logs written before this change still load; every schema change is an optional field."
description: "The dashboard cannot show what a running task or analysis is doing. Hench writes `.run-logs/<ts>-<runId>.log` once, at run end (`packages/hench/src/store/run-log.ts`, called from `agent/lifecycle/shared.ts`), and no route serves it. `RunRecord.events` is only filled in verbose mode. The run's pid exists only in the web server's audit entry, and only for dashboard-started runs. The one live line (`TaskExecutionStatus.lastOutput`) is parsed from stdout of dashboard-started runs, so terminal-started runs show nothing but heartbeat counters. Sourcevision analyze prints `[phase N] Name...` lines and sets `manifest.modules[*].status`, but the web server keeps only the last 3,000 characters of stdout for a dashboard-launched analyze and exposes no structured phase, pass or batch progress.\n\nThis feature adds the data the Live tab needs, all additive: an incremental run log, a structured per-run progress event stream, the pid on the run record, structured analyze progress, tail routes and WebSocket frames, and one aggregate endpoint listing everything live across the repository's worktrees. It must work the same for runs started from a terminal and from the dashboard.\n\nGoal: Every running hench task and sourcevision analysis can be watched step by step from the dashboard, whoever started it and in whichever worktree it runs."
lastModified: "2026-10-01T00:17:38.610Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add one live endpoint listing every running run and job across the repository's worktrees](./add-one-live-endpoint-listing-every.md) | pending |
| [Add tail routes and WebSocket frames for a running hench run's log and events](./add-tail-routes-and-websocket-frames.md) | completed |
| [Expose structured sourcevision analyze progress: phase, enrichment pass, batch and model calls](./expose-structured-sourcevision-analyze.md) | completed |
| [Record a structured progress event stream for every hench run, not only in verbose mode](./record-a-structured-progress-event.md) | completed |
| [Record the agent process pid on the run record for every run](./record-the-agent-process-pid-on-the.md) | completed |
| [Write the hench run log incrementally while the run is in progress](./write-the-hench-run-log-incrementally.md) | completed |
