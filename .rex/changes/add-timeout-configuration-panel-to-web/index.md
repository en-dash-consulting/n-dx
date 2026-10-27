---
id: "1160eb2b-e2d9-40ab-8f3a-fade05c697b8"
type: "change"
title: "Add timeout configuration panel to web settings UI"
slug: "add-timeout-configuration-panel-to-web"
intent: "Surface the CLI timeout settings in the n-dx web dashboard settings panel so users can view and update timeouts without touching the CLI. The panel should show the current global default and any per-command overrides, with save/reset controls that write back to .n-dx.json via the existing config API."
acceptanceCriteria:
  - "The settings UI includes a 'CLI Timeouts' section showing the global timeout and any active per-command overrides"
  - "Editing and saving a timeout value calls the config API and persists to .n-dx.json"
  - "A reset button restores a field to its default value"
  - "Invalid inputs (non-numeric, negative) are rejected client-side with an inline error before submission"
  - "The settings panel reflects external config changes on next page load (no stale cache)"
amends: [{"target":"888de653-60ad-43bf-843c-a859341d22a3","delta":"modified","summary":"Add timeout configuration panel to web settings UI","base":"bf32114e37825ca5b1793afac8e7dcaae453c2413fc018af4710d5e8ee57bd7b"}]
priority: "medium"
tags:
  - "web-ui"
  - "config"
  - "timeout"
  - "settings"
source: "smart-add"
---
