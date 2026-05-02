---
id: "dc5e6696-7575-4983-b8c5-a73711bc4d8f"
level: "feature"
title: "Settings Page Completeness and Command-Based Reorganization"
status: "completed"
source: "smart-add"
startedAt: "2026-04-19T04:37:38.162Z"
completedAt: "2026-04-19T04:37:38.162Z"
acceptanceCriteria: []
description: "The settings page currently covers hench execution config and integration (Notion) config, but leaves large portions of the .n-dx.json schema unexposed — including LLM vendor and model selection, CLI timeout overrides, web port, feature flags, sourcevision zone config, and the language override. Additionally, settings are organized by internal implementation concerns rather than by the CLI commands that consume them, making discoverability poor. This feature closes all missing-field gaps and reorganizes the page around the CLI mental model."
---

## Children

| Title | Status |
|-------|--------|
| [Audit .n-dx.json config schema fields against settings page UI controls and document gaps](./audit-n-dx-json-config-schema-0b6e8b/index.md) | completed |
| [Implement missing config fields in the settings page UI](./implement-missing-config-fields-49f253/index.md) | completed |
| [Reorganize settings page layout to group settings by associated CLI command](./reorganize-settings-page-layout-26f049/index.md) | completed |
