---
id: "74f09a9f-fdf1-4b2a-a272-53bc202d0a91"
type: "change"
title: "Reconcile Codex model-id catalogs and fix dead light-tier alias"
slug: "reconcile-codex-model-id-catalogs-and"
intent: "Codex model identifiers are inconsistent across the config surface: init-llm.js:25 legacy list (gpt-5-codex/gpt-5.1-codex-max/gpt-5.1-codex-mini) is disjoint from llm-model-catalog.js:34-39 (gpt-5.5/gpt-5.4/gpt-5.4-mini/gpt-5.3-codex); gpt-5.3-codex has no alias/tier entry; LEGACY_CODEX_MODEL_ALIASES has 'gpt-5.4mini' (config.ts:85) but TIER_MODELS.codex.light is 'gpt-5.4-mini' (config.ts:76) so the non-hyphen alias is dead; run.ts:885 compat error still suggests outdated gpt-4o/o1. Unify the catalogs, fix the alias, and verify NEWEST_MODELS.codex resolves to a valid codex-CLI model."
touches:
  - "7e14ce05-95ad-4fa4-adc9-73d0c6742566"
priority: "medium"
---
