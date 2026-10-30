---
id: "958566ee-4063-439f-a58b-7b4a1bdcfee6"
type: "change"
title: "A hench-written failureReason outlives the task's completion"
slug: "a-hench-written-failurereason-outlives"
intent: "Out of scope for task 112f9a0f; this predates it and comes from c816a1a3 (run classifier). Scenario: a run fails, and recordRunDiagnosis (packages/hench/src/agent/lifecycle/run-diagnosis.ts) writes the verdict summary as the task's failureReason. The next run completes the task. Nothing in rex or hench clears failureReason; a grep for delete or undefined on failureReason in packages/rex/src and packages/hench/src finds nothing. If the task is reopened, its brief (agent/planning/brief.ts \"Previous attempt failed — do not repeat it\", rex change-brief.ts:688) hands the agent a cause that the successful run already resolved. Any view that shows failureReason on a completed task also shows the stale verdict. Reachability: ndx work → a failed run, then a completed run, then a reopen through rex update or the dashboard. Options: (1, recommended) on a completed run, clear failureReason when it equals the diagnosis.summary of one of the task's runs (reuse earlierVerdictSummaries). This is cheap and never touches a reason a person or the agent wrote. (2) Clear any failureReason on completion. Risk: it drops a human note. Verdict: out-of-scope, low."
acceptanceCriteria:
  - "When a run completes a task whose failureReason equals a diagnosis.summary of one of that task's runs, failureReason is cleared (tested)"
  - "A failureReason written by a person or by the agent is not cleared on completion (tested)"
touches:
  - "3415b5f0-3496-4813-8cc9-9f571044d49c"
priority: "low"
discoveredFrom: {"item":"112f9a0f-f3f3-4024-86f8-aa01ebaba3a1","run":"c9e3a8a7-086b-4581-ab4c-aeb5504c2ef5"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
