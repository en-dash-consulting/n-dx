---
id: "2df3f7df-2deb-4bc5-8349-de7392416582"
level: "task"
title: "The exported computeLanding still reports an open change as landed, because it takes ids rather than the change"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "pr-11"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "computeLanding on an in_progress change whose first task is merged and tagged returns { landed: false, reason: 'change still open' } (test)"
  - "computeLanding on a completed change with the same history returns the merge commit as its landing (test)"
  - "No exported landing function accepts bare ids without the change's status"
description: "Scenario: a caller passes an in_progress change's ids (change id plus task ids) to computeLanding, with task 1 merged and tagged v0.9.0 and task 2 unmerged. computeLanding returns { landed: true, ... }, so resolveShippedIn returns \"0.9.0\" for unfinished work. Task ae3c8475 put the open-change guard (\"change still open\") only in computeLandings, which can see the change's status. computeLanding takes `itemIds: Iterable<string>` and cannot.\n\nEvidence: packages/rex/src/core/change-landing.ts, computeLanding (a thin wrapper around landingFrom with no status check).\n\nReachable: computeLanding has no caller in src, and public.ts does not export it. Only the tests call it today. The first caller that uses it per change instead of computeLandings inherits the defect.\n\nVerdict: should-fix, low. It is a wrong answer only once a caller wires it in.\n\nOptions:\n(a) Make computeLanding take the ChangeNode (or Pick<ChangeNode, 'id'|'status'|'appliedAt'|'aliases'|'children'>), apply the same finished check, and derive the ids with trailerIds. This matches the task's literal wording and removes the trap. The ids-based tests move to a fixture node. Recommended.\n(b) Make computeLanding module-private and keep only computeLandings exported. This is cheapest, but it loses the single-change entry point."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-09T14:52:34.967Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
