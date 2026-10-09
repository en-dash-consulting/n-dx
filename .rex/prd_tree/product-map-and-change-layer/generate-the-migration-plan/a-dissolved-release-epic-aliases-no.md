---
id: "ae89852b-9821-4f7e-a718-2a1a83f6fcf3"
level: "task"
title: "A dissolved release epic aliases no child and is listed in the summary"
status: "pending"
priority: "high"
source: "review"
acceptanceCriteria:
  - "A dissolved release epic's id is not an alias of any child (test)"
  - "The plan summary lists each dissolved release epic with its id, title and plannedRelease (test)"
description: "From the hub review of #616 at 5814234b3 (migrations/v1-to-v2/migration-plan-data.ts:266). A dissolved release epic currently becomes an alias of its first child, whatever that child is, so a lookup of the old epic id lands on an arbitrary change.\n\nDecision D3 (Ryan, 2026-10-08): no alias. Record each dissolved release (old epic id and title, its plannedRelease) in the plan summary, so a lookup of the old id can say what it was.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it."
lastModified: "2026-10-09T02:12:29.176Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
