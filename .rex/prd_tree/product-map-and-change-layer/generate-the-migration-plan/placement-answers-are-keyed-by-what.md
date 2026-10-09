---
id: "c1e234d7-06dc-4ef7-abe7-1ac860478766"
level: "task"
title: "Placement answers are keyed by what the model sees"
status: "completed"
priority: "high"
blockedBy:
  - "33443098-9b72-4313-b8b6-dc7b86bdd403"
source: "review"
startedAt: "2026-10-09T03:40:04.717Z"
completedAt: "2026-10-09T03:46:19.922Z"
endedAt: "2026-10-09T03:46:19.922Z"
acceptanceCriteria:
  - "Renaming a capability outside a held change's shortlist keeps that change's recorded placement answer (test)"
  - "Renaming a capability inside the shortlist asks again (test)"
  - "Replaying a recorded answer gives the same placement decision as when it was recorded (test)"
description: "From the hub review of #616 at 5814234b3 (migrations/v1-to-v2/placement-pass.ts:139). A placement question's recorded answer is keyed on more than the held change and its shortlist, so an unrelated rename re-asks (and pays), while the replayed decision is not guaranteed to match the one recorded.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it."
lastModified: "2026-10-09T03:46:20.156Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
