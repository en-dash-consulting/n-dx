---
id: "795ca04f-3b08-4753-a516-a8e7665e2745"
level: "task"
title: "TIER_MODELS entries can drift out of MODEL_COSTS with no test to catch it"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
startedAt: "2026-08-31T16:34:37.766Z"
completedAt: "2026-08-31T16:40:20.358Z"
endedAt: "2026-08-31T16:40:20.358Z"
acceptanceCriteria:
  - "A test in packages/llm-client iterates every TIER_MODELS[vendor][weight] pair and asserts MODEL_COSTS[model] is defined, skipping empty-string entries (the local vendor)"
  - "The same test asserts MODEL_CONTEXT_WINDOWS[model] is defined for every non-empty TIER_MODELS entry"
  - "Temporarily pointing TIER_MODELS.claude.heavy at an unlisted model ID (e.g. claude-opus-6) makes the new test fail, proving it would catch the drift"
  - "The new test passes against the current TIER_MODELS without any production-code change"
description: "Found by adversarial review of task 85923733 (Correct the remaining stale entries in MODEL_COSTS). Severity: medium. Verdict: out-of-scope (pre-existing; the reviewed task changed no code).\n\nFAILURE SCENARIO: A contributor bumps a Claude or Codex tier constant to a new model ID -- the exact edit this repo has already performed twice (claude-opus-4-7 -> claude-opus-5, and gpt-5.5 -> gpt-5.6-terra in commit a1ab6cc9) -- without adding matching MODEL_COSTS and MODEL_CONTEXT_WINDOWS entries. Then resolveVendorModel('claude', cfg, 'heavy') returns the new ID, and budgetPreflight(newId, 800000) falls through to DEFAULT_CONTEXT_WINDOW=128000 (budget-preflight.ts:67) instead of the model's real 1M window, so a 200k-token prompt is reported fits:false and rejected as too large. estimatedCostUsd also becomes undefined (budget-preflight.ts:71-73), so budget preflight silently stops estimating cost. The full llm-client suite stays green throughout.\n\nEVIDENCE: packages/llm-client/src/config.ts:74-88 (TIER_MODELS), :159-179 (MODEL_CONTEXT_WINDOWS), :189-211 (MODEL_COSTS). packages/llm-client/src/budget-preflight.ts:67,71-73 (silent fallbacks, no guard).\n\nREACHABILITY: Live path -- resolveVendorModel(vendor, config, weight) is the production tier resolver and budgetPreflight consumes model IDs. No current failure: all present TIER_MODELS entries are covered. This is a latent regression-guard gap, not an active bug.\n\nWHY NOT ALREADY COVERED: REVIEW_MODELS has exactly this assertion (tests/unit/review-model.test.ts:96-105, 'has cost and context-window entries for every non-empty recommendation'), and budget-preflight.test.ts:168-172 asserts coverage for GOOGLE_MODELS tiers only. Nothing iterates TIER_MODELS, so the claude and codex tiers are unprotected.\n\nRECOMMENDED FIX: Mirror the existing REVIEW_MODELS test over TIER_MODELS in packages/llm-client/tests/unit/budget-preflight.test.ts -- iterate every vendor/weight pair, skip empty strings (the local vendor legitimately yields ''), and assert both MODEL_COSTS[model] and MODEL_CONTEXT_WINDOWS[model] are defined. ~10 lines, no production change, no risk. Alternative considered and not recommended: making budgetPreflight throw on an unknown model -- that converts a silent degradation into a hard runtime failure on a path where an unknown model is sometimes legitimate (local/LM Studio)."
lastModified: "2026-08-31T16:40:20.363Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
