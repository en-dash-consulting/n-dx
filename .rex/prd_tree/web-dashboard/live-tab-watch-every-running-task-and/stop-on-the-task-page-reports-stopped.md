---
id: "54f9f3c8-401e-4fe3-ad7d-6c98bcd0c8c1"
level: "task"
title: "Stop on the task page reports \"Stopped\" when the server only marked the record and sent no signal"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
startedAt: "2026-10-01T19:29:38.257Z"
completedAt: "2026-10-01T19:37:45.591Z"
endedAt: "2026-10-01T19:37:45.591Z"
acceptanceCriteria:
  - "When the terminate response says no signal was sent, the page says the record was marked but the process was not signalled (unit test)."
  - "The confirm dialog only promises a signal when the run has a trusted pid."
description: "Failure: `packages/web/src/viewer/views/live-task.ts:104,114` shows \"Stopped\" for any 200 response. For a terminal-started run whose pid the server cannot trust, `handleTerminate` returns 200 with `method: \"disk-mark\"` and sends no signal, so the process keeps running while the UI says it stopped; the confirm dialog had promised that pid N \"is sent a stop signal\".\n\nReachability: Stop on a terminal-started run without a trusted pid. Verdict: should-fix (severity medium).\n\nOptions:\n- Recommended: read `signalSent`/`method` from the response and show \"Marked terminated; the process was not signalled\" (with the pid) in that case, and word the confirm dialog to match what will happen. Small."
lastModified: "2026-10-01T19:37:48.052Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
