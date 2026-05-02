---
id: "891e3a9b-8082-4ce5-8a6b-7c5897e38b59"
level: "task"
title: "Wire light-tier model selection into rex smart-add and lightweight analysis paths"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "smart-add"
  - "model-resolution"
source: "smart-add"
startedAt: "2026-04-15T17:34:26.554Z"
completedAt: "2026-04-15T17:39:16.385Z"
acceptanceCriteria:
  - "smart-add.ts resolves its model via resolveVendorModel(vendor, config, 'light') instead of resolveVendorModel(vendor, config)"
  - "ndx add 'some description' uses haiku (Claude) or gpt-5.4mini (Codex) by default, visible in vendor header output"
  - "Explicit --model flag on ndx add overrides the light-tier selection"
  - "rex analyze and rex reorganize continue using standard-tier models (unchanged behavior)"
  - "sourcevision analyze continues using standard-tier models (unchanged behavior)"
description: "Rex smart-add (reasonFromDescriptions, reasonFromIdeasFile in reason.ts) generates proposals from natural language — a bounded single-turn LLM call well-suited for lighter models. Pass TaskWeight 'light' through the smart-add call chain so resolveVendorModel selects haiku/gpt-5.4mini instead of sonnet/gpt-5.4codex. The model parameter plumbing already exists (spawnClaude accepts an optional model), so the change is in how the model is resolved, not in how it's passed."
---

# Wire light-tier model selection into rex smart-add and lightweight analysis paths

🟠 [completed]

## Summary

Rex smart-add (reasonFromDescriptions, reasonFromIdeasFile in reason.ts) generates proposals from natural language — a bounded single-turn LLM call well-suited for lighter models. Pass TaskWeight 'light' through the smart-add call chain so resolveVendorModel selects haiku/gpt-5.4mini instead of sonnet/gpt-5.4codex. The model parameter plumbing already exists (spawnClaude accepts an optional model), so the change is in how the model is resolved, not in how it's passed.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** rex, smart-add, model-resolution
- **Level:** task
- **Started:** 2026-04-15T17:34:26.554Z
- **Completed:** 2026-04-15T17:39:16.385Z
- **Duration:** 4m
