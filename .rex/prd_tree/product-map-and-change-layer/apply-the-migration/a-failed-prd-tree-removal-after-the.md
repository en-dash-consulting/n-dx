---
id: "6139ac49-51d5-4319-827b-41851e9831e3"
level: "task"
title: "A failed prd_tree/ removal after the switch says the v2 tree is in place and to re-run apply"
status: "pending"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
  - "v2-migrate-l7"
blockedBy:
  - "1dc03bda-5534-4dc6-8924-d38acc9826cd"
source: "review-2026-10-12"
acceptanceCriteria:
  - "With the post-switch removal made to fail (injected rm error), apply reports that the v2 tree is in place and that re-running 'ndx migrate --apply' finishes the job, naming the leftover paths (test; fails at 4646976bad)"
  - "A re-run after that injected failure removes the leftovers and leaves the same v2 tree (test)"
description: "Review of #689 (2026-10-12), should-fix. Crash windows CONFIRMED by injection; the Windows EBUSY/EPERM trigger is PLAUSIBLE. packages/rex/src/migrations/v1-to-v2/apply.ts:718: the rm of prd_tree/ and tree-meta.json runs after product/ is renamed in, outside the try/catch.\n\nFailure scenario: a directory handle held by the dashboard's watcher or antivirus (Windows) makes rm fail. The raw error is thrown, the lock is released, and the project has both product/ and prd_tree/. Nothing tells the user to re-run apply, and at this head the v1 FileStore still reads prd_tree/, so 'rex status' shows the v1 tree. Re-applying does converge (the reviewer's four injected crash points all re-applied byte-identically), so the gap is only the message.\n\nFix (kept minimal, per Ryan 2026-10-12): catch a failure of the post-switch cleanup and report 'the v2 tree is in place; run ndx migrate --apply again to remove the v1 leftovers' with the underlying error. No retry machinery."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T19:37:14.740Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
