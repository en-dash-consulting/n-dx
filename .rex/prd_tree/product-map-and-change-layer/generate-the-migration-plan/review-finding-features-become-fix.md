---
id: "91de46df-1eb2-47d3-999f-80c303386545"
level: "task"
title: "Review-finding features become fix changes, not capabilities"
status: "completed"
priority: "high"
source: "live-run"
startedAt: "2026-10-09T14:42:05.639Z"
completedAt: "2026-10-09T14:52:27.183Z"
endedAt: "2026-10-09T14:52:27.183Z"
acceptanceCriteria:
  - "A completed feature under an area whose source is ndx-adversarial-review is a fix change, not a capability (test)"
  - "A completed feature tagged severity:* or ndx-adversarial-review is a fix change (test)"
  - "A completed feature whose title uses defect wording (\"silently\", \"does not\", \"never\", \"cannot\") is a fix change, while a noun-shaped capability title such as \"Offline cache\" stays a capability (test)"
  - "On this repository's tree, the rules-only plan has no capability whose source is ndx-adversarial-review"
description: "From the full-tree live run of 2026-10-09: about 13 of this repository's 309 planned capabilities are review findings whose titles describe a defect, e.g. \"Concurrent stale-lock reclaim can unlink a replacement live lock\", \"`hench record` with no usage window silently claims the entire session transcript\", \"Not every commit n-dx creates carries the Co-Authored-By trailer\". classifyUnderArea (packages/rex/src/migrations/v1-to-v2/migration-plan.ts) makes each a capability because it is a noun-shaped feature with completed work; isFixShaped (around line 176) only knows FIX_WORDS and DEFECT_WORDS (fails, broken, leaks…). The text model then places held changes onto these \"capabilities\", and spec drafting spends a call on each.\n\nThese items carry clear signals: `source: ndx-adversarial-review`, a `severity:*` tag, an `ndx-adversarial-review` tag, or defect wording (\"silently\", \"does not\", \"never\", \"cannot\", \"can … instead of\"). Treat any of them as fix-shaped, so the feature becomes an applied fix change (with its tasks kept) that the placement rules or model passes place on the capability it fixed.\n\nDecision (Ryan, 2026-10-09): fix in PR 13.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it."
lastModified: "2026-10-09T14:52:27.513Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
