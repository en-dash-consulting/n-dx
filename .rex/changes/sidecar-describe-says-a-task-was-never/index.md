---
id: "9b1cfbf3-68c5-4dac-a1c9-ff35b1b6a23c"
type: "change"
title: "Sidecar Describe says a task was never run when its runs are in another worktree"
slug: "sidecar-describe-says-a-task-was-never"
intent: "Found by the adversarial review of 8cb5a7fc. Verdict: out-of-scope (pre-existing, from the Sidecar first lenses). Severity: low.\n\nScenario: a task run in a sibling worktree. createPacketSources().runs(taskId) (packages/web/src/server/sidecar/packet-sources.ts, runs()) still reads only the served worktree's .hench/runs, so the Describe packet (packet-builders.ts:469-476) prints \"No run of this task is recorded.\" Since 8cb5a7fc the Diagnose run lens reads every worktree (taskRun through SpawnedReads.runTargets), so in one session the two lenses now disagree about the same task, and the model can be told it was never attempted.\n\nReachable: a Describe Sidecar session on a task whose runs were made in another worktree of the repository.\n\nOptions:\n(a) Recommended: have runs() read through spawned.runTargets() as taskRun does, merging every worktree's records newest first and naming the worktree on each line. Cost: small; reuses taskRunRecords.\n(b) Say in the Describe section that only this worktree's runs are listed. Cheaper, but still hides the runs."
acceptanceCriteria:
  - "createPacketSources(ctx).runs(taskId) returns the task's runs from every target spawned.runTargets() lists, newest first (unit test with a sibling worktree's run)"
  - "The Describe packet lists a sibling worktree's run with its worktree named instead of 'No run of this task is recorded.' (test)"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "low"
discoveredFrom: {"item":"8cb5a7fc-a5c6-4744-b317-6b7b941b2e4c","run":"a41015c2-7aba-498b-aa56-ca26d64b78d9"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
