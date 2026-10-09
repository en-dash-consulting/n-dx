---
id: "aee05753-ec4b-4a92-bb40-083ad9eb91d5"
level: "task"
title: "An incomplete migration plan drops the later passes' recorded answers, so a retry pays for every Jev judgment again"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-13"
  - "product-map"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "After a complete text+jev plan, a re-plan whose text seam throws still carries the earlier jev answers in its output (test)"
  - "Re-planning from that output with working seams asks jev only for items whose question changed (test)"
description: "Scenario: run 1 completes text + jev over 300 items. One item changes; run 2 asks text for it and the seam throws. runPlanPipeline (packages/rex/src/migrations/pipeline.ts, the `if (stopped) break` at the top of the model-pass loop) skips the jev pass and records only the answers it used, so answers.jev is absent from run 2's plan. Run 3 uses run 2 as previous: text reuses everything, but all 300 jev questions (unchanged, so their prior answers would match) are asked again. Same cost class as bb2a3276, moved one pass later.\n\nReachable once the Jev pass (2f0d7092) lands and migrate --plan calls it; not reachable today. Introduced by bb2a3276. Verdict: should-fix.\n\nOptions:\n1. (Recommended) When a pass is skipped because an earlier one stopped, carry previous.answers[name] into the plan unchanged (the hash/model check on the next run still decides reuse). Cost: a few lines + test; risk: the plan holds answers its header did not run; document it in the plan-file contract.\n2. Run the later pass over items whose earlier-pass answers are complete, reusing priors only and never asking. Cost: more logic; risk: partial merges of jev into entries.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it."
lastModified: "2026-10-09T02:13:14.318Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
