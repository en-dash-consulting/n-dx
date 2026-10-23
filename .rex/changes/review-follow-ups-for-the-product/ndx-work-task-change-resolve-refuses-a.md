---
id: "b1f05a4d-4947-4a7c-b2b5-e3bbed289b76"
type: "task"
title: "ndx work --task=<change> --resolve refuses a change whose open tasks --reset-deferred would reopen"
slug: "ndx-work-task-change-resolve-refuses-a"
description: "Found by the adversarial review of fa6420d7 (run 9775dbd1). Verdict: should-fix, low.\n\nScenario: on a v2 tree, change CH-1's only open task is deferred. `ndx work --task=CH-1 --reset-deferred --resolve` reports a not-actionable refusal (\"has no task to run: … (deferred)\"), but `ndx work --task=CH-1 --reset-deferred` itself resets deferred items before it selects, so the run would pick and run that task. The preview disagrees with the run. A dry run is consistent: selectTaskEntry receives wouldResetIds and reads the tree as reset (readTreeAsReset).\n\nEvidence: packages/hench/src/cli/commands/run-resolve.ts — findV2Entry/changeTasksRefusal run on the unreset v2Tree; only the entry's own status (and the named change's) is lifted by wouldBeReset. The refusal message in work-selection.ts changeTasksRefusal also never mentions --reset-deferred as a remedy for a deferred task.\n\nReachable: `ndx work --resolve` (dashboard Prepare task uses it) with --reset-deferred on a change whose open tasks are deferred. Edge path; no state is written either way.\n\nOptions: (a) in resolveRun, when --reset-deferred applies, read the tree as reset with the same ids a run would reset (readTreeAsReset with the deferred ids matching --mine), then resolve — small, keeps preview == run. Recommended. (b) Only add \"--reset-deferred reopens it\" to the refusal hint — cheaper but leaves the mismatch."
acceptanceCriteria:
  - "`ndx work --task=<change> --reset-deferred --resolve` on a change whose only open task is deferred reports that task with no refusal (test)"
  - "Without --reset-deferred the same resolve still refuses, naming the deferred task (test)"
  - "With --mine, a deferred task assigned to someone else is not treated as reset (test)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "hench"
  - "v2-hardening"
source: "ndx-adversarial-review"
---
