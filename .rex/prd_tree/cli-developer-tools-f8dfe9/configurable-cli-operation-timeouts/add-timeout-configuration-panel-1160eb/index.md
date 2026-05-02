---
id: "1160eb2b-e2d9-40ab-8f3a-fade05c697b8"
level: "task"
title: "Add timeout configuration panel to web settings UI"
status: "completed"
priority: "medium"
tags:
  - "web-ui"
  - "config"
  - "timeout"
  - "settings"
source: "smart-add"
startedAt: "2026-04-03T18:58:26.092Z"
completedAt: "2026-04-20T14:09:06.617Z"
resolutionType: "acknowledgment"
resolutionDetail: "Feature fully implemented in packages/web: CliTimeoutsView (cli-timeout.ts), routes-cli-timeout.ts (GET/PUT /api/cli/timeouts), CSS, view registry, server route registration, and unit tests. All 5 ACs satisfied."
acceptanceCriteria:
  - "The settings UI includes a 'CLI Timeouts' section showing the global timeout and any active per-command overrides"
  - "Editing and saving a timeout value calls the config API and persists to .n-dx.json"
  - "A reset button restores a field to its default value"
  - "Invalid inputs (non-numeric, negative) are rejected client-side with an inline error before submission"
  - "The settings panel reflects external config changes on next page load (no stale cache)"
description: "Surface the CLI timeout settings in the n-dx web dashboard settings panel so users can view and update timeouts without touching the CLI. The panel should show the current global default and any per-command overrides, with save/reset controls that write back to .n-dx.json via the existing config API."
---

# Add timeout configuration panel to web settings UI

🟡 [completed]

## Summary

Surface the CLI timeout settings in the n-dx web dashboard settings panel so users can view and update timeouts without touching the CLI. The panel should show the current global default and any per-command overrides, with save/reset controls that write back to .n-dx.json via the existing config API.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** web-ui, config, timeout, settings
- **Level:** task
- **Started:** 2026-04-03T18:58:26.092Z
- **Completed:** 2026-04-20T14:09:06.617Z
- **Duration:** 16d 19h 10m
