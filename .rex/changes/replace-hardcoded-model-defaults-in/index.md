---
id: "15313bb7-1100-46df-84c7-bbdb8f82c571"
type: "change"
title: "Replace hardcoded model defaults in sourcevision analyze with centralized resolveVendorModel"
slug: "replace-hardcoded-model-defaults-in"
intent: "sourcevision/src/cli/commands/analyze.ts imports DEFAULT_MODEL and DEFAULT_CODEX_MODEL constants and uses them as fallbacks in resolveAnalyzeTokenEventMetadata (lines 56-77) instead of calling resolveVendorModel from @n-dx/llm-client. This means sourcevision ignores user-configured model overrides and tier-based model selection. The resolution should use the same resolveVendorModel(vendor, llmConfig, weight) call path that rex uses, passing through the already-loaded LLMConfig."
acceptanceCriteria:
  - "resolveAnalyzeTokenEventMetadata uses resolveVendorModel(vendor, llmConfig) instead of hardcoded DEFAULT_MODEL/DEFAULT_CODEX_MODEL"
  - "Changing llm.claude.model in .n-dx.json is reflected in sourcevision analyze token event metadata"
  - "Changing llm.vendor in .n-dx.json switches sourcevision to the correct vendor model"
  - "DEFAULT_MODEL and DEFAULT_CODEX_MODEL imports are removed from analyze.ts if no longer needed"
  - "Integration test verifies sourcevision analyze respects .n-dx.json model config"
amends: [{"target":"e34e664a-b788-41e5-ad5d-95c94d9abd8a","delta":"modified","summary":"Replace hardcoded model defaults in sourcevision analyze with centralized resolveVendorModel","base":"d8e9ad94e39b1fffdf135f7cd63f75cd1d2e1550bf78e5e968cf35b7c9e7e89d"}]
priority: "high"
tags:
  - "llm"
  - "sourcevision"
  - "cli"
source: "smart-add"
---
