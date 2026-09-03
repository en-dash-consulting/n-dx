---
id: "cea4d4df-7f07-4b7c-93ca-7a41faf03a4e"
level: "task"
title: "Merge the review pass's per-turn token usage into the run record"
status: "completed"
priority: "high"
startedAt: "2026-09-03T18:20:58.130Z"
completedAt: "2026-09-03T18:29:48.334Z"
endedAt: "2026-09-03T18:29:48.334Z"
resolutionType: "code-change"
resolutionDetail: "chargeReviewToRun now merges the reviewer's turnTokenUsage into the run record alongside the aggregate, offsetting turn numbers past the executor's and tagging entries with the review model. 12 new unit tests."
acceptanceCriteria: []
description: "runAdversarialReviewPass (cli-loop.ts:1161) adds the reviewer's aggregate usage to run.tokenUsage but never concats result.turnTokenUsage into run.turnTokenUsage — accumulateResult (cli-loop.ts:1024) is the only path that does, and the review pass does not go through it. rex/src/core/token-usage.ts:332 builds usage events from turnTokenUsage when it is non-empty and then `continue`s, never falling back to the aggregate, so the reviewer's spend is invisible to ndx usage and the dashboard rollup.\n\nMeasured on a live --review run (fixture run 5c1e9bee, executor claude-sonnet-4-6, reviewer claude-opus-5): run.tokenUsage.output = 28920, but all 20 turnTokenUsage entries are tagged claude-sonnet-4-6 and sum to 3154 output. `ndx usage` printed the aggregate as the headline (29,082) and the per-turn sum as the per-command line (3,200) in the same report — an 89% under-report — and costed the whole run at Sonnet pricing though ~25.8k of the 28.9k output tokens were billed to opus-5.\n\nThis is the exact outcome the comment at cli-loop.ts:1159-1161 says it exists to prevent (\"leaving it out would make --review look free in ndx usage\"). The aggregate half works; the per-turn half was missed. Fix by appending the reviewer's turnTokenUsage entries (tagged with the review model) to the run, so per-model cost rollups price the reviewer correctly.</description>\n<parameter name=\"source\">Discovered while verifying the review pass end-to-end (task 0deece15)"
lastModified: "2026-09-03T18:29:48.362Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
