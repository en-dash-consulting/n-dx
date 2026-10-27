---
id: "af8e534f-2625-4255-a527-f2db30d5107f"
type: "change"
title: "Track per-task attempt counts in hench run loop and force advancement after three repeats"
slug: "track-per-task-attempt-counts-in-hench"
intent: "Instrument the hench run loop to count how many times each task ID has been picked up within a single run invocation. When a task reaches three attempts and a third attempt completes (regardless of success/failure status), exclude that task from subsequent selection in the same run and force the selector to pick a different task. Counter state should be scoped to the current run only."
acceptanceCriteria:
  - "Hench tracks attempt count per task ID within a single run invocation"
  - "After the third completion of the same task, the next iteration selects a different task"
  - "Forced advancement is logged with a clear reason string visible in run output and run records"
  - "Counter resets between separate hench run invocations"
  - "Unit test simulates three repeats of the same task and asserts the fourth iteration picks a different task"
touches:
  - "03266251-06ef-4864-960a-0cb02986ff1d"
priority: "high"
tags:
  - "hench"
  - "run-loop"
  - "reliability"
source: "smart-add"
---
