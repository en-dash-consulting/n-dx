---
id: "bb2a3276-35bc-454b-9eed-6033f6ec63a3"
level: "task"
title: "A seam failure mid-pass discards every model answer the plan already paid for"
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
  - "With a mocked seam that throws on the third question, planning still yields the first two answers in a form the caller can write (test)"
  - "Re-planning with that output as previous does not re-ask the first two items (test)"
  - "A plan whose pass did not finish is distinguishable from a complete one when read back by parsePlanFile (test)"
description: "Scenario: a text pass asks 300 capabilities; seam.ask throws (rate limit, timeout) on item 299. runPlanPipeline (packages/rex/src/migrations/pipeline.ts, the model-pass loop) rejects, the PlanFile is never returned, so the 298 answers already obtained are not recorded anywhere. Re-running with `previous` cannot reuse them, so every item is asked again and paid for again; a flaky model can make the plan never finish.\n\nReachable: once the text spec pass (d6419e1e), enriched placement or the Jev pass (2f0d7092) land and the migrate --plan command calls them. Not reachable today (v1-to-v2 defines no model pass). Introduced by the migrations framework task (ab7b00bb). Verdict: should-fix — real and costly, but nothing calls a model pass yet.\n\nOptions:\n1. (Recommended) On a seam error, stop asking, keep the answers so far, and return the plan with the failed pass marked incomplete in the header (e.g. passes[i].incomplete with the error), so the caller writes it and the next run reuses the answers. Cost: a header field + reader validation + tests. Risk: an incomplete plan must not be applied; apply (PR 23) has to refuse it.\n2. Throw a typed error carrying the partial answers, so the caller can write a checkpoint. Cost: smaller; risk: every caller must remember to handle it.\n3. Per-item error isolation: record the failure for that item, carry on. Cost: moderate; risk: plans silently missing answers unless counted.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`: the affected test gate refuses a stale rex dist/ (run 699cd138 failed only on that)."
lastModified: "2026-10-08T20:26:47.986Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
