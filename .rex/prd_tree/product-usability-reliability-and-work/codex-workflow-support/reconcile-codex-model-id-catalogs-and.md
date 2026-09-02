---
id: "74f09a9f-fdf1-4b2a-a272-53bc202d0a91"
level: "subtask"
title: "Reconcile Codex model-id catalogs and fix dead light-tier alias"
status: "completed"
priority: "medium"
startedAt: "2026-07-10T00:27:45.601Z"
completedAt: "2026-07-10T04:30:34.901Z"
endedAt: "2026-07-10T04:30:34.901Z"
description: "Codex model identifiers are inconsistent across the config surface: init-llm.js:25 legacy list (gpt-5-codex/gpt-5.1-codex-max/gpt-5.1-codex-mini) is disjoint from llm-model-catalog.js:34-39 (gpt-5.5/gpt-5.4/gpt-5.4-mini/gpt-5.3-codex); gpt-5.3-codex has no alias/tier entry; LEGACY_CODEX_MODEL_ALIASES has 'gpt-5.4mini' (config.ts:85) but TIER_MODELS.codex.light is 'gpt-5.4-mini' (config.ts:76) so the non-hyphen alias is dead; run.ts:885 compat error still suggests outdated gpt-4o/o1. Unify the catalogs, fix the alias, and verify NEWEST_MODELS.codex resolves to a valid codex-CLI model."
---
