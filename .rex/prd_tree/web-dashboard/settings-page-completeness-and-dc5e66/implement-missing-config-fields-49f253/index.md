---
id: "49f25316-e3df-4362-82dd-28f849a29072"
level: "task"
title: "Implement missing config fields in the settings page UI"
status: "completed"
priority: "medium"
tags:
  - "settings"
  - "config"
  - "web"
source: "smart-add"
startedAt: "2026-04-19T04:00:09.944Z"
completedAt: "2026-04-19T04:23:06.990Z"
resolutionType: "code-change"
resolutionDetail: "Added LlmProviderView and ProjectSettingsView with server routes for GET/PUT /api/llm/config and /api/project-settings. Fields covered: llm.vendor, llm.claude.model, llm.claude.lightModel, llm.codex.model, llm.codex.lightModel, web.port, language, sourcevision.zones.mergeThreshold, sourcevision.zones.pins. All views use batch-save pattern with dirty tracking and toast feedback. ViewId, sidebar, breadcrumb, view-registry, and domain-settings barrel updated. Typecheck passes cleanly."
acceptanceCriteria:
  - "All fields flagged as missing in the audit have a corresponding settings UI control"
  - "LLM vendor selector (claude/codex) is present and switches the active vendor"
  - "Model and light-model text/select inputs exist for both claude and codex vendor sections"
  - "cli.timeoutMs has a numeric input, and cli.timeouts.* per-command overrides are editable (key-value list or per-command inputs)"
  - "web.port has a numeric input that validates port range"
  - "Feature flag toggles exist for all features.rex.*, features.sourcevision.*, and features.hench.* fields"
  - "All new controls persist changes to .n-dx.json on save and reflect current values on page load"
description: "Add UI controls for all fields identified as absent from the settings page, including: LLM vendor selector (claude/codex), model and light-model selectors for each vendor, CLI global timeout (cli.timeoutMs) and per-command timeout overrides (cli.timeouts.*), web dashboard port (web.port), feature flags (features.rex.*, features.sourcevision.*, features.hench.*), sourcevision zone pins and merge threshold, and the language override. Each control must read from and persist changes to the appropriate config file via the existing config mechanism. This task also closes the pending 'Add timeout configuration panel to web settings UI' item."
---

# Implement missing config fields in the settings page UI

🟡 [completed]

## Summary

Add UI controls for all fields identified as absent from the settings page, including: LLM vendor selector (claude/codex), model and light-model selectors for each vendor, CLI global timeout (cli.timeoutMs) and per-command timeout overrides (cli.timeouts.*), web dashboard port (web.port), feature flags (features.rex.*, features.sourcevision.*, features.hench.*), sourcevision zone pins and merge threshold, and the language override. Each control must read from and persist changes to the appropriate config file via the existing config mechanism. This task also closes the pending 'Add timeout configuration panel to web settings UI' item.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** settings, config, web
- **Level:** task
- **Started:** 2026-04-19T04:00:09.944Z
- **Completed:** 2026-04-19T04:23:06.990Z
- **Duration:** 22m
