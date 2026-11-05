---
id: "112f9a0f-f3f3-4024-86f8-aa01ebaba3a1"
type: "task"
title: "A hench-written failureReason gives way to the next failed run verdict"
slug: "a-hench-written-failurereason-gives"
description: "Implements option 1 of this change. recordRunDiagnosis (packages/hench/src/agent/lifecycle/run-diagnosis.ts, fillFailureReason) writes the verdict summary as failureReason when the task has none. A later failed run may replace failureReason only when its current value equals the diagnosis.summary of an earlier run of the same task (those runs are already read for attempt counting); any other value was written by a person or the agent (rex update --reason, update_task_status) and is kept. No new rex or RunRecord field, and no rex or sourcevision MCP tool shape change."
acceptanceCriteria:
  - "When a task failureReason equals an earlier run diagnosis.summary, the next failed run verdict replaces it (tested: vendor-transient then test-gate-new leaves the test-gate summary)"
  - "A failureReason written by a person or by the agent (rex update --reason, update_task_status) is never overwritten by a verdict (tested)"
  - "The next run brief carries the latest run verdict summary, not the first one"
priority: "medium"
source: "ndx-adversarial-review"
---
