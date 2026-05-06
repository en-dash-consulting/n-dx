---
id: "8bf9ba99-1896-42de-b63e-7b14ed433a7f"
level: "task"
title: "Add llm.autoFailover config flag with schema, loader, and ndx config surface"
status: "pending"
priority: "high"
tags:
  - "llm"
  - "config"
  - "self-heal-items"
source: "smart-add"
acceptanceCriteria:
  - "New boolean field (default false) is added to the LLM config schema and persists round-trip through .n-dx.json"
  - "`ndx config llm.autoFailover` reads, sets, and validates the flag with help text describing the failover behavior"
  - "Settings page in the web dashboard exposes the toggle alongside existing LLM controls"
  - "Unit tests cover schema default, set/get, and invalid-value rejection"
description: "Introduce a new boolean configuration field (default false) controlling whether automatic model/vendor failover engages on run errors. Wire it through the .n-dx.json schema, the config loader, and the `ndx config` command (view/edit/help) so users can toggle it from the CLI and dashboard settings page like other LLM options."
---

# Add llm.autoFailover config flag with schema, loader, and ndx config surface

🟠 [pending]

## Summary

Introduce a new boolean configuration field (default false) controlling whether automatic model/vendor failover engages on run errors. Wire it through the .n-dx.json schema, the config loader, and the `ndx config` command (view/edit/help) so users can toggle it from the CLI and dashboard settings page like other LLM options.

## Info

- **Status:** pending
- **Priority:** high
- **Tags:** llm, config, self-heal-items
- **Level:** task
