---
id: "7ed96bb8-b7fe-4722-9082-bf7f44ec7e70"
level: "task"
title: "A stale analyze progress file still reads as running on Windows and when ps is unavailable"
status: "completed"
priority: "low"
tags:
  - "live"
  - "ndx-adversarial-review"
source: "follow-up of cdf48383 (option b)"
startedAt: "2026-10-01T22:02:52.514Z"
completedAt: "2026-10-01T22:13:23.640Z"
endedAt: "2026-10-01T22:13:23.640Z"
acceptanceCriteria:
  - "A running progress file whose updatedAt is older than the staleness window is reported as interrupted even when the pid is alive and the command line is unknown (unit test with injected clock)."
  - "A running analyze refreshes updatedAt at least once per heartbeat interval while no other writes occur (fake-timer unit test); the timer is unref'd and cleared on finish."
  - "Stop on /live/analyze refuses a stale (heartbeat-expired) file on every platform."
  - "Changeset for @n-dx/sourcevision and @n-dx/web (patch)."
description: "Follow-up to the pid-reuse fix (commit 912743eb3). `readAnalyzeProgress` (packages/sourcevision/src/analyzers/analyze-progress.ts) now checks a live recorded pid's command line through `confirmAnalyzeProcess`. When the command line cannot be read (Windows; `ps` missing, as in some containers), it still trusts `kill(pid, 0)`. A hard-killed analyze whose pid has been reused therefore still shows as running there. On Windows, POST /api/live/analyze/stop also still signals by pid alone (`signalRecordedPid` in packages/web/src/server/routes-live-analyze.ts). Option (b) from the original review: while a run owns the file, write a heartbeat every ~15 s from an unref'd timer in `startAnalyzeProgress` (refresh `updatedAt`, cleared in `finish`). The reader then reports `running` with `updatedAt` older than ~2 min as interrupted, whatever the pid says. Keep the 250 ms ledger coalescing intact."
lastModified: "2026-10-01T22:13:24.035Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
