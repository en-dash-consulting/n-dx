---
id: "8bb23dc3-4322-483a-8540-614f4d86f241"
level: "task"
title: "Add an invariant test requiring every tier pointer to have cost and context-window entries"
status: "pending"
priority: "low"
tags:
  - "e2e-finding"
  - "test-coverage"
  - "severity:low"
source: "ndx-capture"
acceptanceCriteria:
  - "A table-driven test iterates every value in TIER_MODELS, REVIEW_MODELS, NEWEST_MODELS and MODEL_ALIASES"
  - "The test asserts each resolved model id has an entry in both MODEL_COSTS and MODEL_CONTEXT_WINDOWS"
  - "The test fails when a tier is repointed to an id absent from either table"
  - "The test names the offending map and key in its failure message so the fix is obvious"
description: "budget-preflight.test.ts's coverage tests name the three Google tiers explicitly (lines 147-151, 164-168) and otherwise assert only generic properties — all values positive, output >= input. Nothing asserts that the models TIER_MODELS, REVIEW_MODELS, NEWEST_MODELS and MODEL_ALIASES actually point at have entries in MODEL_COSTS and MODEL_CONTEXT_WINDOWS.\n\nTrigger: repoint a tier to a newly released ID without adding table entries — exactly the edit task 85923733 just performed, and the edit the next model release will perform — and budgetPreflight silently falls back to DEFAULT_CONTEXT_WINDOW 128_000 for what may be a 1M-context model, so `fits` returns false for prompts that do fit and estimatedCostUsd becomes undefined. The whole suite stays green.\n\nThe reviewer verified there is no live failure today: every current pointer (haiku-4-5, sonnet-5, opus-5, gpt-5.4-mini, gpt-5.5, the three Gemini tiers, and the opus-4-8/haiku-4-5/sonnet-5 aliases) has entries in both tables. So this is contract drift with no present failure, which is what makes the next change riskier rather than this one broken.\n\nRecurrence is the argument for it: these tables have now gone stale twice — opus-5 and opus-4-8 were added by the review-model work, and 85923733 fixed opus-4-7 and haiku-4-5. A table-driven test iterating every value in the four maps closes it in a few lines."
lastModified: "2026-08-27T16:50:13.261Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
