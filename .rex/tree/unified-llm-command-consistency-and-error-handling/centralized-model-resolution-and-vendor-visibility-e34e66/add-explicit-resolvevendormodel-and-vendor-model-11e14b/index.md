---
id: "11e14b47-8392-42ab-ba33-afc6085807d5"
level: "task"
title: "Add explicit resolveVendorModel and vendor/model header to reshape, reorganize, and prune commands"
status: "completed"
priority: "high"
tags:
  - "llm"
  - "rex"
  - "cli"
source: "smart-add"
startedAt: "2026-04-21T17:09:01.983Z"
completedAt: "2026-04-21T17:17:09.123Z"
resolutionType: "code-change"
resolutionDetail: "Added resolveConfiguredModel + printVendorModelHeader to reshape, reorganize, and prune commands. 19 integration tests verify precedence (flag > config > default) and header ordering."
acceptanceCriteria:
  - "reshape, reorganize, and prune commands call resolveConfiguredModel with the --model flag before passing to reasonForReshape"
  - "All three commands call printVendorModelHeader before the first LLM call, matching smart-add and analyze behavior"
  - "Running reshape/reorganize/prune without --model respects .n-dx.json llm.vendor and llm.claude.model settings"
  - "Running with --model=<override> still takes precedence over config"
  - "Unit tests verify model resolution precedence: explicit flag > config > default for each command"
description: "The reshape (reshape.ts:38), reorganize (reorganize.ts:44), and prune (prune.ts:340,480) commands pass `flags.model` directly to reasonForReshape without calling resolveConfiguredModel first. While the bridge layer eventually resolves a model, this bypasses visible vendor/model header output and makes debugging model selection opaque. Each command should explicitly resolve the model via resolveConfiguredModel (matching smart-add's resolveSmartAddModel pattern) and call printVendorModelHeader before making LLM calls."
---

# Add explicit resolveVendorModel and vendor/model header to reshape, reorganize, and prune commands

🟠 [completed]

## Summary

The reshape (reshape.ts:38), reorganize (reorganize.ts:44), and prune (prune.ts:340,480) commands pass `flags.model` directly to reasonForReshape without calling resolveConfiguredModel first. While the bridge layer eventually resolves a model, this bypasses visible vendor/model header output and makes debugging model selection opaque. Each command should explicitly resolve the model via resolveConfiguredModel (matching smart-add's resolveSmartAddModel pattern) and call printVendorModelHeader before making LLM calls.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** llm, rex, cli
- **Level:** task
- **Started:** 2026-04-21T17:09:01.983Z
- **Completed:** 2026-04-21T17:17:09.123Z
- **Duration:** 8m
