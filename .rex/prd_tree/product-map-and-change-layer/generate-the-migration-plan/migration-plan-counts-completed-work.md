---
id: "d5f6b831-2e40-4000-8391-7df1abee48e8"
level: "task"
title: "Migration plan counts completed work under cancelled or deleted descendants, so a live feature built only from abandoned work becomes a capability"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A pending feature whose only completed work sits under a cancelled task is not classified as a capability (test)"
  - "A pending feature with a completed task beside a cancelled one is still classified as a capability (test)"
description: "Verdict: out-of-scope (pre-existing; seen while reviewing c4fb7a85), low.\n\nScenario: a pending noun-shaped feature \"Offline cache\" whose only child task is cancelled, with a completed subtask under that task. hasCompletedWork (packages/rex/src/migrations/v1-to-v2/migration-plan.ts:163) recurses through the cancelled task, finds the completed subtask, and classifyUnderArea makes the feature a capability. The product layer then states a requirement backed only by abandoned work.\n\nReachability: classifyV1Tree via ndx migrate --plan on any tree where a task was partly done and then cancelled or deleted.\n\nOptions:\n(a) Recommended: hasCompletedWork stops descending at cancelled or deleted items (reuse the isAbandoned helper). One line plus a test.\n(b) Leave the classification and add a review note to the entry. Leaves the wrong default.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it (runs 699cd138 and the PR 17 store-transaction run failed only on that)."
lastModified: "2026-10-08T21:40:56.007Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
