---
id: "75a39df3-1b24-4b8d-8acf-67ed6cea5641"
level: "task"
title: "Cancelled or deleted children of release epics are held, never rules-placed"
status: "pending"
priority: "medium"
source: "review"
acceptanceCriteria:
  - "A cancelled or deleted child of a release epic is an unapplied change with needsPlacement and is never rules-placed (test)"
  - "This matches c4fb7a85's handling of cancelled or deleted items under areas (test)"
description: "From the hub review of #616 at 5814234b3 (migrations/v1-to-v2/migration-plan.ts:273). c4fb7a85 holds cancelled or deleted items under areas, but a cancelled or deleted child of a release epic is still rules-placed as an ordinary change.\n\nDecision D4 (Ryan, 2026-10-08): fixed in PR 13.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it."
lastModified: "2026-10-09T02:12:50.788Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
