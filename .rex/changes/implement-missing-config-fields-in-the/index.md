---
id: "49f25316-e3df-4362-82dd-28f849a29072"
type: "change"
title: "Implement missing config fields in the settings page UI"
slug: "implement-missing-config-fields-in-the"
intent: "Add UI controls for all fields identified as absent from the settings page, including: LLM vendor selector (claude/codex), model and light-model selectors for each vendor, CLI global timeout (cli.timeoutMs) and per-command timeout overrides (cli.timeouts.*), web dashboard port (web.port), feature flags (features.rex.*, features.sourcevision.*, features.hench.*), sourcevision zone pins and merge threshold, and the language override. Each control must read from and persist changes to the appropriate config file via the existing config mechanism. This task also closes the pending 'Add timeout configuration panel to web settings UI' item."
acceptanceCriteria:
  - "All fields flagged as missing in the audit have a corresponding settings UI control"
  - "LLM vendor selector (claude/codex) is present and switches the active vendor"
  - "Model and light-model text/select inputs exist for both claude and codex vendor sections"
  - "cli.timeoutMs has a numeric input, and cli.timeouts.* per-command overrides are editable (key-value list or per-command inputs)"
  - "web.port has a numeric input that validates port range"
  - "Feature flag toggles exist for all features.rex.*, features.sourcevision.*, and features.hench.* fields"
  - "All new controls persist changes to .n-dx.json on save and reflect current values on page load"
amends: [{"target":"dc5e6696-7575-4983-b8c5-a73711bc4d8f","delta":"modified","summary":"Implement missing config fields in the settings page UI","base":"33610213365c131a0bb2b2420511168214da7f097c83752d3c57774815e6bb8f"}]
priority: "medium"
tags:
  - "settings"
  - "config"
  - "web"
source: "smart-add"
---
