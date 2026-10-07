---
id: "91f294f3-6bd3-46ca-a8b4-aceaa7230456"
level: "task"
title: "sv analyze removes its stop handlers before the progress file stops saying running"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "For a run that owns the progress file, the stop handlers are still registered when the progress file is last written (status complete or failed); a unit test pins this by recording process.listenerCount('SIGTERM') at finishAnalyzeProgress"
  - "After cmdAnalyze returns, no SIGTERM/SIGINT listeners added by it remain"
description: "This is the end-of-run mirror of #562. In packages/sourcevision/src/cli/commands/analyze.ts, the `finally` block of cmdAnalyze calls `removeStopHandlers?.()` before `finishAnalyzeProgress(...)`. For a brief moment the progress file still says `running` while no SIGTERM/SIGINT handler is installed.\n\nScenario: a Stop (dashboard or test) reads `running` and sends SIGTERM just as the run finishes. The process dies with the default disposition (code null) instead of exiting 128+signal. The file is left `running` with a dead pid, and readAnalyzeProgress reports `interrupted` for a run whose outputs were all written.\n\nReachability: the window is a few synchronous statements at the end of the run. The cli-analyze SIGTERM e2e test cannot practically hit it, because it sees `running` first at the start. Pre-existing: the finally ordering was not changed by the #562 fix (out-of-scope for that review). Verdict: real and low impact.\n\nOptions:\n- (A, recommended) Call finishAnalyzeProgress before removeStopHandlers. A signal in the new window then reaches a handler that finds no active run: it records nothing and exits 143 for a completed run. Cost: a two-line swap plus a unit test.\n- (B) Leave as is. The outcome is `interrupted` rather than `failed`, and nothing is corrupted."
lastModified: "2026-10-07T19:46:44.663Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
