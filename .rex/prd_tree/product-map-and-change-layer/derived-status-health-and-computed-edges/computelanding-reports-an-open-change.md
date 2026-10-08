---
id: "b7520479-098e-4c2e-9c19-79a6f4649850"
level: "task"
title: "computeLanding reports an open change as landed, so resolveShippedIn gives a release for unfinished work"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "pr-11"
source: "ndx-adversarial-review"
completedAt: "2026-10-08T20:05:12.142Z"
resolutionType: "code-change"
resolutionDetail: "Fixed by task ae3c8475 (commit b2b021a43, merged in #584): computeLanding now reports a change that is not completed or applied as \"change still open\", so resolveShippedIn gives no release for unfinished work. ae3c8475's description names this capture; it was not marked at the time. Closed in the PR 11 cleanup, 2026-10-08."
acceptanceCriteria:
  - "computeLandings on an open change (status pending or in_progress) with a merged task commit returns landed:false with a reason naming the open status (test)"
  - "resolveShippedIn returns undefined for that open change even when a release tag contains its merged commit (test)"
  - "A completed change with the same history still reports the merge commit as its landing (test)"
description: "Scenario: a change has two tasks. Task 1's commit is merged to main and tagged v0.9.0, and task 2 is still on an unmerged branch. computeLandings returns { landed: true, commit: <task 1 merge> } for the change, so resolveShippedIn returns \"0.9.0\" for a change that has not shipped. computeLanding cannot see unmerged commits, so it treats \"newest commit on main\" as \"landed\", whatever the change's status is.\n\nEvidence: packages/rex/src/core/change-landing.ts, computeLanding and computeLandings (neither reads status or appliedAt).\n\nReachable: computeLandings has no caller yet. The first caller (rex health, or the shippedIn fallback in release stamping) inherits the bug.\n\nVerdict: should-fix. It is a silent wrong answer once wired, but nothing reaches it today.\n\nOptions:\n(a) Report a landing only for a change that is completed (or has appliedAt), and return landed:false with the reason \"change still open\" otherwise. This is cheap and makes the semantics explicit. Recommended.\n(b) Keep the landing, add a `complete: boolean` field, and have resolveShippedIn refuse incomplete changes. This keeps the information, but every caller has to check it.\n\nDecision (2026-10-08, Ryan): option (a). Done in the combined task 'Register change-landing with the v2 isolation test, report open changes as not landed, and load landing inputs once'."
lastModified: "2026-10-08T20:05:12.404Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
