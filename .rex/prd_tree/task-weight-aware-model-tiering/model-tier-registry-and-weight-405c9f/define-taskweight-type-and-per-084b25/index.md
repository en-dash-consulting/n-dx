---
id: "084b2529-7458-4255-bc7b-18b6388932e9"
level: "task"
title: "Define TaskWeight type and per-vendor tier model constants in llm-client"
status: "completed"
priority: "critical"
tags:
  - "llm-client"
  - "model-resolution"
  - "foundation"
source: "smart-add"
startedAt: "2026-04-15T17:16:45.191Z"
completedAt: "2026-04-15T17:20:53.465Z"
acceptanceCriteria:
  - "TaskWeight type exported from llm-client public API with values 'light' and 'standard'"
  - "TIER_MODELS constant maps claude→light to haiku, claude→standard to sonnet, codex→light to gpt-5.4mini, codex→standard to gpt-5.4codex"
  - "TIER_MODELS[vendor]['standard'] equals NEWEST_MODELS[vendor] for both vendors"
  - "resolveVendorModel accepts optional TaskWeight parameter; when 'light' is passed it resolves to TIER_MODELS[vendor].light instead of the default"
  - "When TaskWeight is omitted or 'standard', resolveVendorModel behaves identically to current implementation (backward compatible)"
  - "Explicit --model CLI flag or config model override still takes precedence over tier-based selection"
description: "Add a TaskWeight discriminated type ('light' | 'standard') to llm-types.ts and a TIER_MODELS constant mapping each vendor × weight to a concrete model string. This is the single source of truth for which model serves each tier — analogous to how NEWEST_MODELS is the single source for default models today. The 'standard' tier should map to the current NEWEST_MODELS values (sonnet, gpt-5.4codex) so existing behavior is preserved when no weight is specified."
---

# Define TaskWeight type and per-vendor tier model constants in llm-client

🔴 [completed]

## Summary

Add a TaskWeight discriminated type ('light' | 'standard') to llm-types.ts and a TIER_MODELS constant mapping each vendor × weight to a concrete model string. This is the single source of truth for which model serves each tier — analogous to how NEWEST_MODELS is the single source for default models today. The 'standard' tier should map to the current NEWEST_MODELS values (sonnet, gpt-5.4codex) so existing behavior is preserved when no weight is specified.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** llm-client, model-resolution, foundation
- **Level:** task
- **Started:** 2026-04-15T17:16:45.191Z
- **Completed:** 2026-04-15T17:20:53.465Z
- **Duration:** 4m
