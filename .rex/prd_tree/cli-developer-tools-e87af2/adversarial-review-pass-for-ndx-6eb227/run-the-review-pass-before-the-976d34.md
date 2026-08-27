---
id: "976d34af-75f4-4fe3-bd74-15afed3413e9"
level: "task"
title: "Run the review pass before the executor's own commit, not after it"
status: "pending"
priority: "high"
tags:
  - "review-pass"
  - "e2e-finding"
  - "severity:high"
source: "ndx-capture"
acceptanceCriteria:
  - "A review-enabled run where the executor attempts its own commit still has the review pass execute against an uncommitted working tree"
  - "A must-fix repair applied by the reviewer lands in the same commit as the work it repairs, verified by git show on a real run"
  - "The executor is either prevented from committing during review-enabled runs, or its commit is folded back before the review pass runs"
  - "A regression test asserts the review pass observes a dirty tree when the executor has committed"
description: "The feature's stated contract is that review runs before the commit \"so the fixes land in the same commit as the work they repair\" (adversarial-review.ts module docstring; cli-loop.ts:1310-1313). Run 60c3a951 violated it: the executor agent ran `git commit` itself mid-run, producing work commit 138d9585 at 09:26:19, and the review report was not written until 09:34:59 — 8m40s later. Any must-fix repair the reviewer applied could not have joined the commit it was repairing.\n\nThe pass ordering in cli-loop.ts is correct; the gap is that nothing prevents the spawned agent from committing before the pass runs. The agent has `git` in guard.allowedCommands and the task brief does not forbid committing.\n\nOptions: forbid `git commit` in the executor's brief/guard for review-enabled runs and let hench own the commit; or detect a self-commit before the review pass and soft-reset it so the reviewer's repairs can be folded in; or accept the split and amend the work commit after a repair. The first is cheapest and matches how the feature was described."
lastModified: "2026-08-27T16:47:41.083Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
