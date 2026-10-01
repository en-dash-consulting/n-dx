---
id: "eeb6c79c-d3ab-4ace-afb5-955d1074dee8"
level: "task"
title: "The live analysis page shows an older dashboard run's output and error against a newer terminal-started run"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A terminal-started analyze after a finished dashboard analyze shows no Output and no error line from the earlier run (unit test)."
  - "A dashboard-started analyze still shows its own output."
description: "Failure: `packages/web/src/server/routes-live-analyze.ts:340,348` sets `outputAvailable = slot !== null && (dashboardRun || !running)` without comparing the dashboard slot's time with the current progress file's run. A dashboard analyze fails at 09:00 with \"Phase 4 failed: rate limited\"; at 11:00 a terminal analyze runs; the 11:00 run's page shows the 09:00 stdout as its Output, and if the 11:00 run fails outside the phases (so `progress.error` is unset), `failureSummary` (`live-analyze-model.ts:203`) presents the 09:00 error line as this run's error. `svAnalyzeRunOf` does not expose `finishedAt`.\n\nReachability: a terminal analyze after a dashboard analyze in the same server session. Verdict: should-fix (severity medium).\n\nOptions:\n- Recommended: expose `finishedAt` from the slot and use the slot's output only when `slot.startedAt <= progress.startedAt` and (`finishedAt` is null or `>= progress.startedAt`). Small."
lastModified: "2026-10-01T15:22:29.052Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
