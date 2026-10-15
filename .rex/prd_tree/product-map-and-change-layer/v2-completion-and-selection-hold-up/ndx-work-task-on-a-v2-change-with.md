---
id: "b135e1f6-b6ea-434e-ac34-51986408db99"
level: "task"
title: "ndx work --task on a v2 change with tasks claims the change while another worktree holds one of its tasks"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-35"
  - "lane-hench"
  - "hench"
  - "v2-hardening"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "ndx work --task=<change with live tasks> on a v2 tree never claims the change itself: it claims and runs one of the change's tasks that no other worktree holds (test)"
  - "No claim is written for such a change's id (test)"
  - "When every live task of the change is claimed by another worktree, the run is refused naming those tasks (test)"
description: "Out-of-scope finding from the adversarial review of 44043b84 (pre-existing selection code). Verdict: out-of-scope, real.\n\nScenario: worktree B runs `ndx work` and claims task WIRE of change CH-1. Worktree A then runs `ndx work --task=CH-1`. resolveWorkById returns CH-1 as a `change` unit, because CH-1's shape is \"tasks\", not \"container\". selectTaskEntry (packages/hench/src/agent/planning/brief.ts, explicit-task branch) claims the change id, which nobody holds, so A runs the whole change, including the task B is working. rex's claim_task refuses this claim with \"is a change with tasks: claim one of its tasks instead\". hench and rex disagree about the claimable unit. Completion at the end also fails: completeV2Work(CH-1) throws ChangeCompletionError while tasks are open, and updateCompletedTaskStatus reports it only as a warning.\n\nOptions:\n(a) Refuse `--task` on a change with live tasks, with rex's message, and name the tasks to run instead. Cheap. Recommended.\n(b) Claim every live task of the change as well. Costlier, and it changes what a run's unit is."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T04:38:49.934Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
