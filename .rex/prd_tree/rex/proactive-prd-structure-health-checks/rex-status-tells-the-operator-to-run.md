---
id: "bc725a60-ae7a-469e-86ae-a0976f4c303b"
level: "task"
title: "rex status tells the operator to run rex fix for parents rex fix will not touch"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "renderAutoCompletableHints does not print the 'Run rex fix' line when every auto-completable parent is in_progress"
  - "A unit test in packages/rex/tests/unit/cli/commands/status-sections.test.ts covers the all-in_progress case and fails against today's unconditional line"
  - "When both pending and in_progress auto-completable parents exist, the output distinguishes which ones rex fix will act on"
description: "Severity: low. Verdict: should-fix. Introduced by the rex fix reopen/stuck-parent change.\n\nFAILURE SCENARIO. findAutoCompletable (packages/rex/src/cli/commands/status-sections.ts:140) deliberately returns BOTH pending and in_progress parents whose children are all completed — the divergence from AUTO_COMPLETABLE_STATUSES is documented there as intentional, because since #368 an in_progress parent that really has finished would otherwise never be mentioned. renderAutoCompletableHints then prints, unconditionally, 'Run rex fix to close the pending ones.' On a PRD where every auto-completable parent is in_progress, rex status advertises a repair and rex fix correctly reports 'No issues found.' — rex fix's stuck_parent kind only touches pending parents.\n\nREACHABILITY. Any PRD with an in_progress parent whose children are all completed and no pending parent in the same state. Reached by plain `rex status`.\n\nSOLUTIONS.\n1. (recommended) Split the rendering: list pending parents under the 'Run rex fix' line and in_progress ones under a separate line saying they are an explicit claim only a human should close. Cost: ~10 lines in renderAutoCompletableHints plus a test. Risk: none; output-only.\n2. Print the hint only when at least one listed parent is pending. Cheaper, but loses the chance to explain why the in_progress ones are excluded — which is the confusion that made #368 hard to reason about in the first place.\n3. Do nothing. The line is mildly wrong rather than harmful."
lastModified: "2026-09-12T09:10:22.965Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
