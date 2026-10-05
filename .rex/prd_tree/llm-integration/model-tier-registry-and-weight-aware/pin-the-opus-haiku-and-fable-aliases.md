---
id: "824db86c-352c-41ee-a925-05333477d544"
level: "task"
title: "Pin the opus, haiku and fable aliases to literal model ids instead of tier slots"
status: "completed"
priority: "low"
startedAt: "2026-10-02T05:03:40.882Z"
completedAt: "2026-10-02T05:23:02.387Z"
endedAt: "2026-10-02T05:23:02.387Z"
acceptanceCriteria: []
description: "Found reviewing the 5.5 model-list hotfix (2026-10-02). Severity: low. This is a latent coupling, not a live bug.\n\nPROBLEM\nIn packages/llm-client/src/config.ts, MODEL_ALIASES now maps `opus: TIER_MODELS.claude.heavy` and `haiku: TIER_MODELS.claude.light`. That ties a model-family shorthand to a tier slot. If the heavy tier is ever pointed at a Fable model (a plausible future change), `--model=opus` silently resolves to Fable at 2.5x the price, and `ndx config ... opus` stops meaning Opus. Before the hotfix both were literal ids.\n\nSOLUTION\n- Make the `opus`, `haiku` and `fable` aliases literal ids: \"claude-opus-5-5\", \"claude-haiku-4-5\" and \"claude-fable-5-1\". `sonnet: NEWEST_MODELS.claude` may stay, because the Sonnet line is the standard tier by definition. Add a one-line comment on MODEL_ALIASES saying family aliases are pinned literally on purpose.\n- Leave `REVIEW_MODELS.claude = TIER_MODELS.claude.heavy` as it is. Review intentionally follows the heavy tier.\n- Add a unit test: each family alias resolves to an id containing its family name (resolveModel(\"opus\") includes \"opus\", and so on). Also assert today's exact values.\n\nOUT OF SCOPE: tier values, review model, every other vendor.\n\nACCEPTANCE CRITERIA\n- resolveModel(\"opus\") === \"claude-opus-5-5\", resolveModel(\"haiku\") === \"claude-haiku-4-5\", resolveModel(\"fable\") === \"claude-fable-5-1\", resolveModel(\"sonnet\") === \"claude-sonnet-5-5\".\n- A test fails if any family alias resolves to an id outside its family.\n- A changeset bumps @n-dx/llm-client at patch.\n- pnpm build and pnpm test pass from the repo root."
lastModified: "2026-10-02T05:23:03.847Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
