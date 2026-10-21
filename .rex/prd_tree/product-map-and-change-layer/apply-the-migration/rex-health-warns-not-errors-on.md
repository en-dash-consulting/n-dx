---
id: "266170f3-df38-4382-bbd9-90d12c8661bc"
level: "task"
title: "rex health warns, not errors, on completed changes the migration held for placement"
status: "completed"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
blockedBy:
  - "1aba5faa-aa60-4566-a045-928ab6c61795"
source: "review-2026-10-12"
startedAt: "2026-10-16T02:46:08.745Z"
completedAt: "2026-10-16T02:53:42.922Z"
endedAt: "2026-10-16T02:53:42.922Z"
resolutionType: "code-change"
resolutionDetail: "change-placed-at-close is a warning for a held change closed at or before the migration cut (found by cut-change title + body prefix); error otherwise. No new v2 field."
acceptanceCriteria:
  - "A held (needsPlacement) change completed before the cut reports change-placed-at-close as a warning, and rex health exits 0 on it (test; fails at 4646976bad)"
  - "A held change that is still open reports no change-placed-at-close finding (open changes are not closing) and is unaffected (test)"
  - "A change with needsPlacement completed after the cut still reports change-placed-at-close as an error (test)"
description: "Review of #689 (2026-10-12), should-fix added by the lead reviewer, CONFIRMED. The migration holds 123 completed v1 changes in changes/inbox/ with needsPlacement. rex change place refuses completed or applied changes ('only an open change is placed'), so they can never leave the Inbox, and the change-placed-at-close rule (packages/rex/src/schema/v2-rules.ts:226, :336) reports each as a permanent error: rex health on a migrated copy of this repository exits 1 with 123 change-placed-at-close errors.\n\nDecision S2-Q2 (Ryan, 2026-10-12): rex health reports change-placed-at-close as a warning for a change that carries the migration's needsPlacement and was completed at or before the migration's cut; it stays an error for everything else (an open held change, or a change completed after the cut). Keep it minimal: identify the cut from what the migrated tree already holds (the cut change), adding no new v2 field if avoidable; if a field is unavoidable, add a soft-freeze line to the changeset."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T02:53:43.195Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
