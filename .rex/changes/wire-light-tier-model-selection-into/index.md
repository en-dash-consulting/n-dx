---
id: "891e3a9b-8082-4ce5-8a6b-7c5897e38b59"
type: "change"
title: "Wire light-tier model selection into rex smart-add and lightweight analysis paths"
slug: "wire-light-tier-model-selection-into"
intent: "Rex smart-add (reasonFromDescriptions, reasonFromIdeasFile in reason.ts) generates proposals from natural language — a bounded single-turn LLM call well-suited for lighter models. Pass TaskWeight 'light' through the smart-add call chain so resolveVendorModel selects haiku/gpt-5.4mini instead of sonnet/gpt-5.4codex. The model parameter plumbing already exists (spawnClaude accepts an optional model), so the change is in how the model is resolved, not in how it's passed."
acceptanceCriteria:
  - "smart-add.ts resolves its model via resolveVendorModel(vendor, config, 'light') instead of resolveVendorModel(vendor, config)"
  - "ndx add 'some description' uses haiku (Claude) or gpt-5.4mini (Codex) by default, visible in vendor header output"
  - "Explicit --model flag on ndx add overrides the light-tier selection"
  - "rex analyze and rex reorganize continue using standard-tier models (unchanged behavior)"
  - "sourcevision analyze continues using standard-tier models (unchanged behavior)"
touches:
  - "effae917-a7c4-4c7a-a0f8-2b8dce95ca58"
priority: "high"
tags:
  - "rex"
  - "smart-add"
  - "model-resolution"
source: "smart-add"
---
