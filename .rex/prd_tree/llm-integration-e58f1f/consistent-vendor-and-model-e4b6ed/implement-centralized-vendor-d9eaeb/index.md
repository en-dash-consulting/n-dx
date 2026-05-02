---
id: "d9eaeb4f-6fb4-4ead-b644-4bc2d99ba4d6"
level: "task"
title: "Implement centralized vendor/model resolver with newest-model default"
status: "completed"
priority: "high"
tags:
  - "llm"
  - "config"
  - "foundation"
source: "smart-add"
startedAt: "2026-04-08T13:33:23.136Z"
completedAt: "2026-04-08T13:52:42.313Z"
acceptanceCriteria:
  - "A single exported function (e.g. resolveModel(vendor, config)) returns the correct model string for all supported vendors"
  - "The 'newest model' fallback constant per vendor is defined in one place and can be updated in a single edit"
  - "Reasoning/thinking invocations and standard API call sites both call the same resolver — no duplicated model derivation logic remains"
  - "Unit tests assert the resolver returns the correct model for configured, unconfigured, and unknown-vendor inputs"
description: "Create a single resolver in llm-gateway (or llm-client) that, given a vendor, returns the canonical model to use. The resolver must consult .n-dx.json / hench config first, then fall back to a hardcoded 'newest model' constant per vendor. All call sites that currently hard-code or independently derive a model string must be updated to call this resolver instead, including reasoning/extended-thinking invocations so that those calls stay in sync with standard API calls."
---

# Implement centralized vendor/model resolver with newest-model default

🟠 [completed]

## Summary

Create a single resolver in llm-gateway (or llm-client) that, given a vendor, returns the canonical model to use. The resolver must consult .n-dx.json / hench config first, then fall back to a hardcoded 'newest model' constant per vendor. All call sites that currently hard-code or independently derive a model string must be updated to call this resolver instead, including reasoning/extended-thinking invocations so that those calls stay in sync with standard API calls.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** llm, config, foundation
- **Level:** task
- **Started:** 2026-04-08T13:33:23.136Z
- **Completed:** 2026-04-08T13:52:42.313Z
- **Duration:** 19m
