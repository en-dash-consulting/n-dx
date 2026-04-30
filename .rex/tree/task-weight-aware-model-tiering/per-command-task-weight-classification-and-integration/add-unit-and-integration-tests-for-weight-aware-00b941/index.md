---
id: "00b9416d-868f-4c13-93f5-9507096d46d7"
level: "task"
title: "Add unit and integration tests for weight-aware model resolution across packages"
status: "completed"
priority: "high"
tags:
  - "testing"
  - "llm-client"
  - "rex"
  - "regression"
source: "smart-add"
startedAt: "2026-04-15T17:25:50.449Z"
completedAt: "2026-04-15T17:33:33.089Z"
acceptanceCriteria:
  - "Unit tests in llm-client cover: resolveVendorModel with light weight returns haiku/gpt-5.4mini, with standard returns sonnet/gpt-5.4codex, with no weight returns standard default"
  - "Unit tests cover config override: lightModel in config takes precedence over TIER_MODELS default"
  - "Unit tests cover precedence: explicit model string overrides tier-based selection for both weights"
  - "Integration test verifies smart-add command resolves to light-tier model by inspecting resolved model before LLM call"
  - "Integration test verifies analyze command resolves to standard-tier model"
  - "Vendor header output tests verify tier label rendering for light, standard, configured-override, and flag-override scenarios"
description: "Verify that the task-weight-aware model tiering works end-to-end: the correct tier is applied per command, config overrides take precedence, CLI flags override everything, and the vendor header displays the right tier label. Cover both Claude and Codex vendors, both light and standard tiers, and the fallback chain (flag → config tier → TIER_MODELS → NEWEST_MODELS)."
---

# Add unit and integration tests for weight-aware model resolution across packages

🟠 [completed]

## Summary

Verify that the task-weight-aware model tiering works end-to-end: the correct tier is applied per command, config overrides take precedence, CLI flags override everything, and the vendor header displays the right tier label. Cover both Claude and Codex vendors, both light and standard tiers, and the fallback chain (flag → config tier → TIER_MODELS → NEWEST_MODELS).

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** testing, llm-client, rex, regression
- **Level:** task
- **Started:** 2026-04-15T17:25:50.449Z
- **Completed:** 2026-04-15T17:33:33.089Z
- **Duration:** 7m
