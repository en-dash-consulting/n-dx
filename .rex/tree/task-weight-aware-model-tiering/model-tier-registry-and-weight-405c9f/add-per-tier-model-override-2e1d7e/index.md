---
id: "2e1d7e90-5f15-49bf-a919-0e4faa742105"
level: "task"
title: "Add per-tier model override fields to LLMConfig schema and config loader"
status: "completed"
priority: "high"
tags:
  - "llm-client"
  - "config"
  - "schema"
source: "smart-add"
startedAt: "2026-04-15T17:20:54.496Z"
completedAt: "2026-04-15T17:25:49.092Z"
acceptanceCriteria:
  - "ClaudeConfig and CodexConfig interfaces gain optional lightModel field"
  - "loadLLMConfig reads lightModel from .n-dx.json when present"
  - "resolveVendorModel(vendor, config, 'light') uses config.claude.lightModel (or codex equivalent) when set, falling back to TIER_MODELS[vendor].light"
  - "ndx config --help documents the new lightModel field with example values"
  - "Unit tests cover: config override present, config override absent (falls back to TIER_MODELS), explicit --model flag overrides tier config"
description: "Extend ClaudeConfig and CodexConfig interfaces to support tier-specific model overrides (e.g., llm.claude.lightModel, llm.codex.lightModel) in .n-dx.json. Update loadLLMConfig and resolveVendorModel to consult these fields so users can customize which model serves each tier without changing the defaults. The resolution order becomes: CLI --model flag → config tier-specific model → TIER_MODELS default → NEWEST_MODELS fallback."
---

# Add per-tier model override fields to LLMConfig schema and config loader

🟠 [completed]

## Summary

Extend ClaudeConfig and CodexConfig interfaces to support tier-specific model overrides (e.g., llm.claude.lightModel, llm.codex.lightModel) in .n-dx.json. Update loadLLMConfig and resolveVendorModel to consult these fields so users can customize which model serves each tier without changing the defaults. The resolution order becomes: CLI --model flag → config tier-specific model → TIER_MODELS default → NEWEST_MODELS fallback.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** llm-client, config, schema
- **Level:** task
- **Started:** 2026-04-15T17:20:54.496Z
- **Completed:** 2026-04-15T17:25:49.092Z
- **Duration:** 4m
