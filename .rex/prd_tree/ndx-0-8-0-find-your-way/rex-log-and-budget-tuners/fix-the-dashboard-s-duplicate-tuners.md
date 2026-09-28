---
id: "2b6d34ae-ab56-4aa1-bfd0-dc14b2389132"
level: "task"
title: "Fix the dashboard's duplicate tuners, which auto-apply a token budget below the arrival cost"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "rex-log-budget-tuners"
  - "web"
source: "Found while completing 114c4bc8 (hench-side tuner units)"
acceptanceCriteria:
  - "Both dashboard tuners count uncached input + cache writes + output, matching checkTokenBudget."
  - "No tokenBudget the dashboard proposes or auto-applies is below the measured context-write floor."
  - "The high-consumption threshold is rescaled into the same units, as it was in the hench workflow tuner."
  - "A test drives the recorded prompt-cached run profiles through the web routes and asserts the proposals are in the budget's units."
  - "Drift between the web copies and packages/hench/src/agent/token-cost.ts is prevented by a test or by removing the duplication."
description: "packages/web/src/server/routes-workflow.ts and routes-adaptive.ts each carry a self-contained copy of the hench tuners — commented \"Analysis engine (self-contained — no imports from hench)\" — with the same defect 114c4bc8 just fixed in hench: totalTokens() is (input + output), the high-consumption threshold is still 100000, and proposals are unclamped (routes-adaptive.ts:420 recentAvgTokens * 2.5; routes-workflow.ts:244 avgTokensPerRun * 0.7).\n\nThis copy is worse than the hench one was. The hench tuners are unreachable from any shipped command, which is why 114c4bc8 was scoped to library consumers. These routes are wired into packages/web/src/server/start.ts, and routes-adaptive.ts marks the tokenBudget adjustment autoApplicable: true, which line 532 turns into an \"auto-applied\" change when state.settings.enabled. On a prompt-cached project with adaptive optimization enabled the dashboard can therefore write a tokenBudget below the roughly 185K a run pays for its initial context write, and every later run fails on arrival — without an operator ever approving the number.\n\nFix approach: web cannot import hench (wrong tier, and there is no hench gateway in packages/web/src/server/), so the helper in packages/hench/src/agent/token-cost.ts cannot be reused directly. Either port the same counting and the contextWriteFloor clamp into the web copies, or decide deliberately that these routes should read hench's analysis rather than reimplement it — the latter is an architecture change needing a gateway and should not be done incidentally. Whichever is chosen, the two web copies and the hench original must not drift again.\n\nSee packages/hench/src/agent/token-cost.ts and tests/unit/agent/token-cost.test.ts for the counting rule, the contextWriteFloor rationale, and the recorded run fixture."
lastModified: "2026-09-28T20:29:41.251Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
