---
id: "51d7e30c-a7c3-4172-bbf0-80842ebcbf94"
level: "task"
title: "Implement consecutive-failure counter and 3-strike auto-cancel in --loop mode"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "loop"
  - "reliability"
source: "smart-add"
startedAt: "2026-05-26T14:00:38.457Z"
completedAt: "2026-05-26T14:07:02.501Z"
endedAt: "2026-05-26T14:07:02.501Z"
resolutionType: "code-change"
resolutionDetail: "Implemented ConsecutiveFailureCounter integration in runLoop function. Counter tracks consecutive failures across loop iterations, records success to reset, and exits loop with diagnostic message when 3-strike threshold is reached. All 23 regression tests pass."
acceptanceCriteria:
  - "Loop exits automatically after exactly 3 consecutive failed runs with a non-zero exit code"
  - "A successful run at any point resets the consecutive failure counter to zero"
  - "Exit message names the auto-cancellation reason, the failure count, and the last task attempted"
  - "Loop does not exit early when failures are non-consecutive (e.g., fail, pass, fail, pass, fail does not trigger cancellation)"
  - "The threshold of 3 is applied per loop invocation, not per task"
description: "Add a mutable failure counter to the hench loop runner that increments on each run that ends in a failure state (non-zero exit, test-gate rejection, or rollback trigger) and resets to zero on any successful run completion. When the counter reaches 3, terminate the loop with a clear diagnostic message that includes the last failure reason, the number of consecutive failures, and a suggestion to inspect the run log before retrying."
---
