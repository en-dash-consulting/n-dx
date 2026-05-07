---
id: "8bf9ba99-1896-42de-b63e-7b14ed433a7f"
level: "task"
title: "Add llm.autoFailover config flag with schema, loader, and ndx config surface"
status: "completed"
priority: "high"
tags:
  - "llm"
  - "config"
  - "self-heal-items"
source: "smart-add"
startedAt: "2026-05-06T14:31:44.611Z"
completedAt: "2026-05-06T14:48:51.322Z"
endedAt: "2026-05-06T14:48:51.322Z"
resolutionType: "code-change"
resolutionDetail: "Added llm.autoFailover config field to schema (llm-types.ts), loader (llm-config.ts), CLI validator and help (config.js), web API (routes-llm.ts), web UI (llm-provider.ts with ToggleField), and unit tests (llm-config.test.ts, cli-config.test.js). Field defaults to false, persists through .n-dx.json, validates via ndx config CLI and web dashboard."
acceptanceCriteria:
  - "New boolean field (default false) is added to the LLM config schema and persists round-trip through .n-dx.json"
  - "`ndx config llm.autoFailover` reads, sets, and validates the flag with help text describing the failover behavior"
  - "Settings page in the web dashboard exposes the toggle alongside existing LLM controls"
  - "Unit tests cover schema default, set/get, and invalid-value rejection"
description: "Introduce a new boolean configuration field (default false) controlling whether automatic model/vendor failover engages on run errors. Wire it through the .n-dx.json schema, the config loader, and the `ndx config` command (view/edit/help) so users can toggle it from the CLI and dashboard settings page like other LLM options."
---
