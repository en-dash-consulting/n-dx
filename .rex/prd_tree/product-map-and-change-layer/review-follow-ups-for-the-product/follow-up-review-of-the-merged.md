---
id: "101c4d39-8483-457f-bb2b-ac476632a426"
level: "task"
title: "Follow-up review of the merged migration plan (PR 13) before the migration is applied"
status: "pending"
priority: "high"
source: "review"
acceptanceCriteria:
  - "A second reviewer and Ryan approve the area list, recording renames, merges and dissolutions as decisions on this task"
  - "The boundary exceptions are accepted or each gets a follow-up task"
  - "The review pass over the merged migrations code is done and its findings are captured as tasks"
  - "The full-tree live plan is re-run on the merged code and its counts are recorded on this task"
  - "Each low capture listed above is run, moved to a release, or cancelled with a reason"
description: "PR 13 (#616) merges ahead of a final review because 0.9.0 is a soft freeze rather than the 1.0.0 cut (Ryan, 2026-10-09). This task holds what that review covers, so nothing is lost and PR 23 does not apply an unreviewed plan.\n\nCovers:\n- A review pass over the merged migrations code (packages/rex/src/migrations/, the two prompt modules in packages/rex/src/analyze/), at the same depth as the hub review of #616 at 5814234b3.\n- The proposed area list: 19 areas, 18 flagged \"not named for a job\" by the rules and all 19 by Jev; Web Dashboard and the review-sourced Security & Data Safety epic (5bbac2f2) need a decision.\n- The boundary exceptions listed in #616: freeSlug in core/apply-amendments.ts, isUsableFrozenSlug in store/, the prd.migrate.judge task-class registration.\n- The full-tree live run of 2026-10-09 (text claude-sonnet-5-5 and jev-1.13.0, summarised in #616): spot-check spec drafts and the 117 held changes' suggestions, then re-run it on the merged code (it reuses unchanged answers).\n- The low captures left in this feature: 5bbac2f2 (review-sourced epic becomes an empty area), bd1c46d8 (template statement check accepts two wrong statements), 678d4043 (stale-description flag on incident write-ups)."
lastModified: "2026-10-09T15:03:15.478Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
