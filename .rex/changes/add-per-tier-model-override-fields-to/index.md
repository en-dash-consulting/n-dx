---
id: "2e1d7e90-5f15-49bf-a919-0e4faa742105"
type: "change"
title: "Add per-tier model override fields to LLMConfig schema and config loader"
slug: "add-per-tier-model-override-fields-to"
intent: "Extend ClaudeConfig and CodexConfig interfaces to support tier-specific model overrides (e.g., llm.claude.lightModel, llm.codex.lightModel) in .n-dx.json. Update loadLLMConfig and resolveVendorModel to consult these fields so users can customize which model serves each tier without changing the defaults. The resolution order becomes: CLI --model flag → config tier-specific model → TIER_MODELS default → NEWEST_MODELS fallback."
acceptanceCriteria:
  - "ClaudeConfig and CodexConfig interfaces gain optional lightModel field"
  - "loadLLMConfig reads lightModel from .n-dx.json when present"
  - "resolveVendorModel(vendor, config, 'light') uses config.claude.lightModel (or codex equivalent) when set, falling back to TIER_MODELS[vendor].light"
  - "ndx config --help documents the new lightModel field with example values"
  - "Unit tests cover: config override present, config override absent (falls back to TIER_MODELS), explicit --model flag overrides tier config"
amends: [{"target":"405c9fcf-2258-472f-8eb7-30d5b7ae0b8a","delta":"modified","summary":"Add per-tier model override fields to LLMConfig schema and config loader","base":"37fe8adac5d971a45455ac7de9b05f94f0dafbf6fd525c3830377ceb55c9e3ae"}]
priority: "high"
tags:
  - "llm-client"
  - "config"
  - "schema"
source: "smart-add"
---
