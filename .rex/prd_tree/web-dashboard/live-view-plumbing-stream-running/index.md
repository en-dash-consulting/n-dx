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
| [A run log ending in an incomplete UTF-8 sequence makes the Log tab refetch the same cursor forever](./a-run-log-ending-in-an-incomplete-utf.md) | completed |
| [A stale analyze progress file still reads as running on Windows and when ps is unavailable](./a-stale-analyze-progress-file-still.md) | completed |
| [A stale analyze progress file whose pid was reused shows a phantom running analysis, and Stop signals the unrelated process](./a-stale-analyze-progress-file-whose.md) | completed |
| [Add hench check-runs to audit and end dead runs from the CLI, across every worktree of the repository](./add-hench-check-runs-to-audit-and-end.md) | completed |
| [Add loop position and hub-queued execute requests to GET /api/live](./add-loop-position-and-hub-queued.md) | pending |
| [Add one live endpoint listing every running run and job across the repository's worktrees](./add-one-live-endpoint-listing-every.md) | completed |
| [Add tail routes and WebSocket frames for a running hench run's log and events](./add-tail-routes-and-websocket-frames.md) | completed |
| [An analyze that fails after its phases is recorded as failed with no reason](./an-analyze-that-fails-after-its-phases.md) | completed |
| [/api/live re-parses the PRD index on a 10-second timer instead of when the file changes](./api-live-re-parses-the-prd-index-on-a.md) | completed |
| [/api/live shows a run whose process died as healthy for up to 5 minutes although pidAlive is known](./api-live-shows-a-run-whose-process.md) | completed |
| [Count worktrees with a live run, and the Home pill's running count, by liveness verdict instead of run status](./count-worktrees-with-a-live-run-and.md) | completed |
| [Decide whether a running hench run is actually running from its recorded pid, host and heartbeat, with lock files as the fallback](./decide-whether-a-running-hench-run-is.md) | completed |
| [During a --deep analyze, sub-package phases are compared with the root's previous times and cost resets per package](./during-a-deep-analyze-sub-package.md) | completed |
| [End dead runs across every worktree from one reconcile route, with one terminal status shared with Mark stuck](./end-dead-runs-across-every-worktree.md) | completed |
| [Expose structured sourcevision analyze progress: phase, enrichment pass, batch and model calls](./expose-structured-sourcevision-analyze.md) | completed |
| [Live test gaps: clock-dependent analyze route fixture, untested stop handlers and log-stream fallback, unregistered LiveSources seam](./live-test-gaps-clock-dependent-analyze.md) | completed |
| [Make the Live strip's agent slots match the repository-wide run list, using the hub's admission capacity when served through the hub](./make-the-live-strip-s-agent-slots.md) | completed |
| [On a project's first run the live .run-logs file is not git-ignored, so --review commits it as a review repair](./on-a-project-s-first-run-the-live-run.md) | completed |
| [Record a structured progress event stream for every hench run, not only in verbose mode](./record-a-structured-progress-event.md) | completed |
| [Record the agent process pid on the run record for every run](./record-the-agent-process-pid-on-the.md) | completed |
| [Report each running run's liveness verdict in /api/live and runs/health across every worktree, pinned to hench's rules by a parity test](./report-each-running-run-s-liveness.md) | completed |
| [Tail path confinement trusts .run-logs or .hench/runs when the directory itself is a symlink](./tail-path-confinement-trusts-run-logs.md) | completed |
| [The live analysis page's last-run times and estimate filter on exact mode, so cascade runs get none in phases 1-3 or an old run's](./the-live-analysis-page-s-last-run.md) | completed |
| [The live analysis page shows an older dashboard run's output and error against a newer terminal-started run](./the-live-analysis-page-shows-an-older.md) | completed |
| [The Live machine strip's vendor and model ignore the default vendor and hench model overrides, disagreeing with the effective config](./the-live-machine-strip-s-vendor-and.md) | completed |
| [vendorPid is not recorded while the review pass and the warm-parent orientation spawn are running](./vendorpid-is-not-recorded-while-the.md) | completed |
| [Write the hench run log incrementally while the run is in progress](./write-the-hench-run-log-incrementally.md) | completed |
