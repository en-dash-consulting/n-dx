---
id: "cd231b6b-4b32-4d7b-aa77-b569bb0f3cb4"
type: "task"
title: "No test fails when Apply's shippedIn guard is dropped, though shipped-but-unapplied changes exist"
slug: "no-test-fails-when-apply-s-shippedin"
description: "Verdict: should-fix (medium). Found by adversarial review of task 27b86abd (Apply decides from the change's own detail).\n\nScenario: in packages/web/src/viewer/components/prd-tree/change-apply.ts, delete `&& !item.shippedIn` from isAwaitingApply. Every test in tests/unit/viewer/change-apply.test.ts still passes, because its \"shipped\" fixture also sets appliedAt, so the appliedAt guard hides it. Yet `rex release stamp` (packages/rex/src/core/release-stamp.ts:85-92) stamps shippedIn on completed changes with no appliedAt; this repo's own .rex tree has 2 such changes. With the guard gone, their detail panel would offer Apply… on a shipped change, diverging from the server's stageOf (routes-rex/product.ts:217), which calls them \"shipped\".\n\nReachable: the change detail panel (task-detail.ts → ChangeApplySection) for any completed change stamped by a release before it was applied.\n\nFix (recommended): make the test's \"shipped\" fixture `{ status: \"completed\", shippedIn: \"0.9.1\" }` with no appliedAt, or add that as a separate case, and add unit cases for isAwaitingApply. Cost: a few test lines; no risk."
acceptanceCriteria:
  - "A change-apply test renders a completed change with shippedIn and no appliedAt and asserts no Apply… is shown"
  - "Removing `!item.shippedIn` from isAwaitingApply makes a test fail"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
source: "ndx-adversarial-review"
---
