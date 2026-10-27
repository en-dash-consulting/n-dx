---
id: "51d7e30c-a7c3-4172-bbf0-80842ebcbf94"
type: "change"
title: "Implement consecutive-failure counter and 3-strike auto-cancel in --loop mode"
slug: "implement-consecutive-failure-counter"
intent: "Add a mutable failure counter to the hench loop runner that increments on each run that ends in a failure state (non-zero exit, test-gate rejection, or rollback trigger) and resets to zero on any successful run completion. When the counter reaches 3, terminate the loop with a clear diagnostic message that includes the last failure reason, the number of consecutive failures, and a suggestion to inspect the run log before retrying."
acceptanceCriteria:
  - "Loop exits automatically after exactly 3 consecutive failed runs with a non-zero exit code"
  - "A successful run at any point resets the consecutive failure counter to zero"
  - "Exit message names the auto-cancellation reason, the failure count, and the last task attempted"
  - "Loop does not exit early when failures are non-consecutive (e.g., fail, pass, fail, pass, fail does not trigger cancellation)"
  - "The threshold of 3 is applied per loop invocation, not per task"
amends: [{"target":"29e95bbb-1741-4d7f-b608-19930e6e05d6","delta":"modified","summary":"Implement consecutive-failure counter and 3-strike auto-cancel in --loop mode","base":"95d89ab007b83a5da01a25e8dcb2928645a811f525cb52982c6f95eabba6f279"}]
priority: "high"
tags:
  - "hench"
  - "loop"
  - "reliability"
source: "smart-add"
---
