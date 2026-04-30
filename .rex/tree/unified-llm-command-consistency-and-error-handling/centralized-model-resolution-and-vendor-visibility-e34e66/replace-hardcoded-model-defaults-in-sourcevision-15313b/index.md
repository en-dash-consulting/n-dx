---
id: "15313bb7-1100-46df-84c7-bbdb8f82c571"
level: "task"
title: "Replace hardcoded model defaults in sourcevision analyze with centralized resolveVendorModel"
status: "completed"
priority: "high"
tags:
  - "llm"
  - "sourcevision"
  - "cli"
source: "smart-add"
startedAt: "2026-04-21T17:17:51.175Z"
completedAt: "2026-04-21T17:23:33.325Z"
resolutionType: "code-change"
resolutionDetail: "Replaced hardcoded DEFAULT_MODEL/DEFAULT_CODEX_MODEL fallbacks in resolveAnalyzeTokenEventMetadata with resolveVendorModel(rawVendor, llmConfig) from @n-dx/llm-client. Removed DEFAULT_MODEL/DEFAULT_CODEX_MODEL imports from analyze.ts. Updated 3 existing unit tests and added 3 new ones (config override, vendor switch). Created integration test (5 cases) verifying .n-dx.json model/vendor config is reflected in token event metadata."
acceptanceCriteria:
  - "resolveAnalyzeTokenEventMetadata uses resolveVendorModel(vendor, llmConfig) instead of hardcoded DEFAULT_MODEL/DEFAULT_CODEX_MODEL"
  - "Changing llm.claude.model in .n-dx.json is reflected in sourcevision analyze token event metadata"
  - "Changing llm.vendor in .n-dx.json switches sourcevision to the correct vendor model"
  - "DEFAULT_MODEL and DEFAULT_CODEX_MODEL imports are removed from analyze.ts if no longer needed"
  - "Integration test verifies sourcevision analyze respects .n-dx.json model config"
description: "sourcevision/src/cli/commands/analyze.ts imports DEFAULT_MODEL and DEFAULT_CODEX_MODEL constants and uses them as fallbacks in resolveAnalyzeTokenEventMetadata (lines 56-77) instead of calling resolveVendorModel from @n-dx/llm-client. This means sourcevision ignores user-configured model overrides and tier-based model selection. The resolution should use the same resolveVendorModel(vendor, llmConfig, weight) call path that rex uses, passing through the already-loaded LLMConfig."
---

# Replace hardcoded model defaults in sourcevision analyze with centralized resolveVendorModel

🟠 [completed]

## Summary

sourcevision/src/cli/commands/analyze.ts imports DEFAULT_MODEL and DEFAULT_CODEX_MODEL constants and uses them as fallbacks in resolveAnalyzeTokenEventMetadata (lines 56-77) instead of calling resolveVendorModel from @n-dx/llm-client. This means sourcevision ignores user-configured model overrides and tier-based model selection. The resolution should use the same resolveVendorModel(vendor, llmConfig, weight) call path that rex uses, passing through the already-loaded LLMConfig.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** llm, sourcevision, cli
- **Level:** task
- **Started:** 2026-04-21T17:17:51.175Z
- **Completed:** 2026-04-21T17:23:33.325Z
- **Duration:** 5m
