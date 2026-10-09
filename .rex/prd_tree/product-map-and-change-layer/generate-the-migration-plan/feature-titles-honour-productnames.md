---
id: "9ed1510c-19c1-42a1-ba08-d0b0418e5511"
level: "task"
title: "Feature titles honour productNames when reading a release"
status: "completed"
priority: "medium"
source: "review"
startedAt: "2026-10-09T03:51:29.664Z"
completedAt: "2026-10-09T03:58:13.384Z"
endedAt: "2026-10-09T03:58:13.384Z"
acceptanceCriteria:
  - "With productNames [\"Acme\"], a feature titled \"Acme 2.1 search\" is a change with plannedRelease 2.1 (test)"
  - "Without productNames, feature classification is unchanged (test)"
description: "From the hub review of #616 at 5814234b3 (migrations/v1-to-v2/migration-plan.ts:191). 8443a9e1 made epic release detection take productNames, but feature titles still use the default names only, so another repository's \"Acme 2.1 search\" feature is not read as a release change.\n\nDecision D4 (Ryan, 2026-10-08): fixed in PR 13.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it."
lastModified: "2026-10-09T03:58:13.713Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
