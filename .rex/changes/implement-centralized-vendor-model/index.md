---
id: "d9eaeb4f-6fb4-4ead-b644-4bc2d99ba4d6"
type: "change"
title: "Implement centralized vendor/model resolver with newest-model default"
slug: "implement-centralized-vendor-model"
intent: "Create a single resolver in llm-gateway (or llm-client) that, given a vendor, returns the canonical model to use. The resolver must consult .n-dx.json / hench config first, then fall back to a hardcoded 'newest model' constant per vendor. All call sites that currently hard-code or independently derive a model string must be updated to call this resolver instead, including reasoning/extended-thinking invocations so that those calls stay in sync with standard API calls."
acceptanceCriteria:
  - "A single exported function (e.g. resolveModel(vendor, config)) returns the correct model string for all supported vendors"
  - "The 'newest model' fallback constant per vendor is defined in one place and can be updated in a single edit"
  - "Reasoning/thinking invocations and standard API call sites both call the same resolver — no duplicated model derivation logic remains"
  - "Unit tests assert the resolver returns the correct model for configured, unconfigured, and unknown-vendor inputs"
amends: [{"target":"e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb","delta":"modified","summary":"Implement centralized vendor/model resolver with newest-model default","base":"72ab1827391674e6a3dc9150c1476cb2fac8141013dff1fcb67d866b5a642295"}]
priority: "high"
tags:
  - "llm"
  - "config"
  - "foundation"
source: "smart-add"
---
