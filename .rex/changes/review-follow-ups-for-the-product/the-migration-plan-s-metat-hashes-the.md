---
id: "9f1e5cff-2247-471b-b823-06096e00244b"
type: "task"
title: "The migration plan's metAt hashes the rules-stage spec draft and goes stale once a later pass redrafts the spec"
slug: "the-migration-plan-s-metat-hashes-the"
description: "Out-of-scope finding from the adversarial review of task 1aba5faa (wire migrate apply onto #715). buildPlanData (packages/rex/src/migrations/v1-to-v2/migration-plan-data.ts:339) sets ItemPlanData.metAt = specHash(draft) in the rules stage (index.ts:136). The later stages draftSettledSpecs (a derive stage that runs even with --rules-only) and the text spec pass (spec-pass.ts) replace entry.spec, but nothing recomputes data.metAt. Result: for any capability whose spec was redrafted, the plan file records a metAt that is not the hash of the spec the plan proposes. A reviewer reading the plan sees a wrong value. Reachability: `ndx migrate --plan` writes the plan; no code consumes data.metAt today (apply.ts stamps metAt from the written spec, pinned by apply.test.ts \"stamps a met capability's metAt from the spec it writes\"), so the harm is a misleading plan field, not a wrong tree. Verdict: out-of-scope (planner, #715), low. Options: (1) recompute data.metAt from the final entry.spec in summarize or after the spec stages (cheap; recommended); (2) drop data.metAt and keep only entry.met, since apply derives the hash itself (smaller surface, but changes the plan format)."
acceptanceCriteria:
  - "For a met capability whose spec a later plan stage redrafts, the written plan's data.metAt equals specHash of the final entry.spec (or data.metAt is no longer in the plan format)"
  - "A unit test plans a tree with a stub text spec pass that changes a met capability's statement and asserts the plan's metAt matches the final spec"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "review-2026-10-12"
  - "severity:low"
  - "lane-migration"
  - "v2-migrate-l7"
source: "ndx-adversarial-review"
---
