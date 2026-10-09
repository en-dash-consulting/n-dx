---
id: "27e4f378-d825-49cf-9668-1e82dba28ed4"
level: "task"
title: "Wire ndx migrate --plan to write the classified plan"
status: "pending"
priority: "high"
tags:
  - "pr-13"
  - "lane-migration"
  - "rex"
  - "core"
blockedBy:
  - "6b78242d-169b-4db5-8a6f-dee4d78da413"
source: "roadmap"
acceptanceCriteria:
  - "ndx migrate --plan writes a plan file and leaves .rex/prd_tree/ unchanged (test)"
  - "The plan lists every v1 item with its target, the proposed areas with notes, and the proposed constraints"
  - "Re-running on an unchanged tree writes an identical file"
description: "`classifyV1Tree` (packages/rex/src/core/migration-plan.ts) is pure and wired to nothing. Add the command: `ndx migrate --plan` (orchestration spawns a rex command, e.g. `rex migrate-plan`) loads the v1 tree, runs `classifyV1Tree`, and writes a reviewable plan file to an operator path outside `.rex/` (Markdown summary for review, plus the plan keyed by item id for apply). It writes nothing to the tree. Remove `core/migration-plan.ts` from the v2 isolation list in tests/unit/schema/v2.test.ts only when the v2 store is wired, not here, unless the command itself imports it from a v2 module.\n\nDefaults from the sampled live run of 2026-10-09 (see #616): set `rex.placement.models` to \"text\" for the migration (text placement and text spec drafting) and turn the Jev review on (`jevReview: true`), with Jev placement off. On the sample the text model placed all 4 held changes correctly (two on the right capability, one sensible new-capability proposal, one correct none-fits), while Jev picked wrongly on 3 (one at confidence 0.69) and abstained on 1; Jev's confident criterion flags were useful. Measured: 16 spec redrafts ~6.7 s each on claude-sonnet-5-5; Jev 22 calls, 3.2 s. A full-tree run of this repository (309 specs, 117 held) is roughly 430 text calls (~45 min sequential) and 450 Jev calls.\n\nSecond sampled live run (2026-10-09, text placement, Jev review only): under autoAccept \"agree\" a text-only placement is never auto-accepted, because agree needs a second tier to agree. Every held change stays held with the text model's suggestion recorded for a reviewer to confirm (the 4 suggestions were the same sensible picks as the first run). Keep that in mind when choosing the default: text-only placement suggests, it does not place."
lastModified: "2026-10-09T05:23:43.948Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
