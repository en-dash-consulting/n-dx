---
id: "54f9f3c8-401e-4fe3-ad7d-6c98bcd0c8c1"
type: "change"
title: "Stop on the task page reports \"Stopped\" when the server only marked the record and sent no signal"
slug: "stop-on-the-task-page-reports-stopped"
intent: "Failure: `packages/web/src/viewer/views/live-task.ts:104,114` shows \"Stopped\" for any 200 response. For a terminal-started run whose pid the server cannot trust, `handleTerminate` returns 200 with `method: \"disk-mark\"` and sends no signal, so the process keeps running while the UI says it stopped; the confirm dialog had promised that pid N \"is sent a stop signal\".\n\nReachability: Stop on a terminal-started run without a trusted pid. Verdict: should-fix (severity medium).\n\nOptions:\n- Recommended: read `signalSent`/`method` from the response and show \"Marked terminated; the process was not signalled\" (with the pid) in that case, and word the confirm dialog to match what will happen. Small."
acceptanceCriteria:
  - "When the terminate response says no signal was sent, the page says the record was marked but the process was not signalled (unit test)."
  - "The confirm dialog only promises a signal when the run has a trusted pid."
touches:
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
---
