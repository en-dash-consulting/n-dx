---
id: "8acd2c1c-c921-4960-adcd-5c28e05fb320"
level: "task"
title: "v2 split leaves an open activeIntervals entry on a change that returns to pending"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-16"
  - "rex"
  - "pr-17"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "After addTask splits an in_progress change with an open activeIntervals entry, the change has no open interval (test in tests/unit/core/change-completion.test.ts)"
  - "The new task carries an open interval for the in-flight work"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "Verdict: should-fix (found by the adversarial review of PR 16 task 3d03ab41).\n\nScenario: an in_progress task-less change with activeIntervals [{start: S}] (open, no end) gains its first task through addTask (packages/rex/src/core/change-completion.ts, addTask). The change goes back to pending but keeps its open interval, and the new task gets no interval. core/durations.ts sums intervals, so the pending change keeps accruing active time while the task, which now holds the work, shows none.\n\nReachability: not yet. change-completion.ts is unwired until the v2 store transaction lands. It becomes reachable once the dashboard or the CLI adds a task through it.\n\nOptions:\n(a) Close the change's open interval at the split time and open one on the task starting then. Cheap, and duration stays truthful per node. Recommended.\n(b) Move the open interval to the task, which matches how startedAt is copied. This loses the change's own record of time spent.\nThe design boundary on 2026-10-08 said nothing about intervals, so Ryan should pick (a) or (b).\n\nDecision (2026-10-08, Ryan): option (a). Close the change's open interval at the split and open one on the new task."
lastModified: "2026-10-08T21:43:51.649Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
