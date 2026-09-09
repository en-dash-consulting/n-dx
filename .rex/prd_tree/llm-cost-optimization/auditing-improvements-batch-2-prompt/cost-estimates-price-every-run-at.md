---
id: "e4ab52b8-8a30-431d-9686-d0c711555113"
level: "task"
title: "Cost estimates price every run at Sonnet rates regardless of the model actually used"
status: "pending"
priority: "medium"
acceptanceCriteria:
  - "A per-model price table covers every model id in TIER_MODELS for claude, codex and google, with all four token kinds"
  - "estimateCost groups turnTokenUsage by model before pricing instead of applying one rate to a collapsed aggregate"
  - "ndx rex usage prices a mixed-model history correctly and no longer prints a blanket 'based on Sonnet pricing' caveat"
  - "An unknown model id degrades to a labelled fallback rate rather than throwing or silently pricing at zero"
  - "A test prices a fixture run at Opus rates and asserts the total differs from the Sonnet-rate total"
description: "estimateCost (packages/rex/src/core/token-usage.ts:708) takes a ModelPricing parameter but every caller uses the single hardcoded DEFAULT_PRICING at Sonnet rates (3 dollars per MTok in / 15 out, cache write 3.75, cache read 0.30). This repo's own .n-dx.json sets llm.model=claude-opus-5 (5 in / 25 out), so ndx rex usage reported 44.18 dollars for three measured Opus runs whose actual cost was about 73.64 - a 40 percent understatement, exactly the Sonnet-to-Opus ratio. The label says 'based on Sonnet pricing' (usage.ts:251) so it is honest rather than silently wrong, but it makes cost figures unusable for the before/after comparisons this epic exists to produce. The data needed is already recorded: every turnTokenUsage entry carries vendor and model alongside all four token kinds. Two changes: a per-model price table (it belongs beside TIER_MODELS in llm-client, which already knows every model id), and grouping by model before pricing, since estimateCost currently receives an AggregateTokenUsage that has already collapsed across models. Known caveats to fold in: a 1h cache write is 2x input rather than 1.25x, and long-context surcharges apply above 200K input on some models."
lastModified: "2026-09-09T16:49:32.657Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
