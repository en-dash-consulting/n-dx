---
id: "8eb10061-ea57-4e03-970b-7b0a5a5af1db"
level: "task"
title: "No test pins that a kept v2 completion suppresses the failed-run rollback"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-35"
  - "lane-hench"
  - "hench"
  - "review-2026-10-12"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test with rollback enabled and a confirming rollback prompt shows that a kept v2 completion's change stays applied and the task stays completed after finalizeRun"
  - "The same test fails when the appliedChangeOfCompletion clause is removed from the rollback condition"
description: "Verdict: should-fix (low). Found by the adversarial review of 16197f3e (run 26a42285).\n\nfinalizeRun's rollback condition (packages/hench/src/agent/lifecycle/shared.ts, the `!(opts.store && run.taskId && (await appliedChangeOfCompletion(...)))` clause) keeps the failed-run rollback from reverting the PRD writes of a kept v2 completion. performRollbackIfNeeded's default scope is PRD-only and its interactive prompt defaults to Yes, so without the clause a bare Enter would revert product/ and changes/: the change is unapplied and the task reset, contradicting the run error that just said to commit them. Every test in v2-applied-completion-kept.test.ts runs with rollbackOnFailure: false or autonomous mode (no prompt), so deleting the clause fails no test.\n\nReachable: an interactive `ndx work` (TTY, no --yes, rollback on) on a v2 tree, after a failure that keeps the completion.\n\nOption (recommended): an integration test that drives finalizeRun with the rollback prompt seam answering yes (see promptRollbackConfirm and its existing tests) and asserts that no rollback is offered and the change stays applied. Test-only change, small."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T04:22:21.134Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
