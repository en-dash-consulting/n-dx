---
id: "c852de51-4539-48eb-b7e8-39e8c9877516"
level: "task"
title: "A kept v2 completion's commit commands sweep the operator's pre-run edits into the task's commit"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-35"
  - "lane-hench"
  - "hench"
  - "review-2026-10-12"
  - "v2-hardening"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a v2 copy with a file modified before the run (in baselineDirty), a kept completion's run error leaves that file out of the git add/git commit commands it prints (test)"
  - "The run error still names the pre-run file, as dirty before the run and not part of the task (test)"
description: "Verdict: should-fix (low). Found by the adversarial review of 16197f3e (run 26a42285).\n\nFailure: keepAppliedCompletion (packages/hench/src/agent/lifecycle/shared.ts) lists paths with findUncommittedWork({ projectDir }) and no discounts, then formatAppliedCompletionKept tells the operator to \"Land them\" with `git add -- <all paths>` and `git commit -m \"Land the work of task <id>\" -m \"N-DX-Item: <id>\" -- <all paths>`, with no stash alternative. A file the operator had already modified before the run started (captured in opts.baselineDirty) is listed too, so following the commands commits the operator's unrelated in-flight edit under the task's N-DX-Item trailer, and rex's change evidence then attributes it to the task. That is the WM2048 hazard renderRecoveryCommands' doc warns about.\n\nReachable: `ndx work` started on a dirty tree that the pre-run gate let through, on a v2 tree, then any failure after the completion applied its change (rejected commit, review-repair staging or commit, a bypassed completion followed by a failed gate).\n\nOptions:\n1. (Recommended) Thread opts.baselineDirty into withdrawCompletionClaim, or record the baseline on the run, and list baseline paths separately as \"already dirty before the run, not part of this task\", left out of the commit commands. Cheap; the performCommitPromptIfNeeded call sites need the baseline passed through.\n2. Keep one list but offer `git stash push` for the baseline paths. Less precise."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T04:38:53.439Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
