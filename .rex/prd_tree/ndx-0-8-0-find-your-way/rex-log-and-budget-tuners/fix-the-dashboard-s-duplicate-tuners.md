---
id: "2b6d34ae-ab56-4aa1-bfd0-dc14b2389132"
level: "task"
title: "Fix the dashboard's duplicate tuners, which recommend a token budget below the arrival cost"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "rex-log-budget-tuners"
  - "web"
source: "Found while completing 114c4bc8 (hench-side tuner units), review of run 9154a5e0; GitHub issue en-dash-consulting/n-dx#431"
acceptanceCriteria:
  - "Both dashboard tuners count uncached input + cache writes + output, matching checkTokenBudget."
  - "No tokenBudget the dashboard proposes is below the measured context-write floor."
  - "The high-consumption threshold is rescaled into the same units only for projects whose runs have cache writes, as in the hench workflow tuner after 3168b075."
  - "Adjustments that the operator must still apply are not labelled \"auto-applied\"."
  - "A test drives the recorded prompt-cached run profiles through the web routes and asserts the proposals are in the budget's units."
  - "Drift between the web copies and packages/hench/src/agent/token-cost.ts is prevented by a test or by removing the duplication."
description: "packages/web/src/server/routes-workflow.ts and routes-adaptive.ts each carry a self-contained copy of the hench tuners (commented \"Analysis engine (self-contained — no imports from hench)\") with the same defect 114c4bc8 fixed in hench: totalTokens() is (input + output) (routes-adaptive.ts:206, routes-workflow.ts:163), the high-consumption threshold is still 100000 (routes-workflow.ts:234), and tokenBudget proposals are unclamped (routes-adaptive.ts:327 tokenBudget * 1.3, routes-adaptive.ts:420 recentAvgTokens * 2.5, routes-workflow.ts:244 avgTokensPerRun * 0.7).\n\nImpact: unlike the hench tuners, these routes are wired into packages/web/src/server/start.ts and shown in the Adaptive and Workflow optimisation views. On a prompt-cached project they can recommend a tokenBudget below the roughly 185K a run pays for its initial context write; if the operator applies it, every later run fails on arrival. The config is written only on operator action: adaptive-optimization.ts:155-161 posts /api/hench/adaptive/apply with automatic: false from the Apply button, and workflow-optimization.ts posts /api/hench/workflow/apply after a preview. But routes-adaptive.ts:532 labels these adjustments \"auto-applied\" when adaptive settings are enabled (the default, routes-adaptive.ts:168), so a harmful number is presented as already vetted. No other caller of either /apply route was found in packages/web/src/.\n\nFix approach: web cannot import hench (wrong tier, and there is no hench gateway in packages/web/src/server/), so the helper in packages/hench/src/agent/token-cost.ts cannot be reused directly. Either port the same counting and the contextWriteFloor clamp into the web copies, or decide deliberately that these routes should read hench's analysis rather than reimplement it; the latter is an architecture change needing a gateway and should not be done incidentally. Whichever is chosen, the web copies and the hench original must not drift again. A port should also avoid the two gaps tracked in 3168b075: the threshold rescale must not apply to projects without cache writes, and the floor-clamp tests must fail when the clamp is removed.\n\nTarget: the release after 0.8.0 (not part of 0.8.0 PR B1). Tracked on GitHub as en-dash-consulting/n-dx#431."
lastModified: "2026-09-28T21:07:41.406Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
