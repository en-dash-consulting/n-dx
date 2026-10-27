---
id: "8bf9ba99-1896-42de-b63e-7b14ed433a7f"
type: "change"
title: "Add llm.autoFailover config flag with schema, loader, and ndx config surface"
slug: "add-llm-autofailover-config-flag-with"
intent: "Introduce a new boolean configuration field (default false) controlling whether automatic model/vendor failover engages on run errors. Wire it through the .n-dx.json schema, the config loader, and the `ndx config` command (view/edit/help) so users can toggle it from the CLI and dashboard settings page like other LLM options."
acceptanceCriteria:
  - "New boolean field (default false) is added to the LLM config schema and persists round-trip through .n-dx.json"
  - "`ndx config llm.autoFailover` reads, sets, and validates the flag with help text describing the failover behavior"
  - "Settings page in the web dashboard exposes the toggle alongside existing LLM controls"
  - "Unit tests cover schema default, set/get, and invalid-value rejection"
amends: [{"target":"2e136c81-64ea-4b4f-96ad-d070f98665e1","delta":"modified","summary":"Add llm.autoFailover config flag with schema, loader, and ndx config surface","base":"e20d73473682b6d4e8b7b1bdb1e6487fa4c03636c9564e539c43f6949b2c7166"}]
priority: "high"
tags:
  - "llm"
  - "config"
  - "self-heal-items"
source: "smart-add"
---
