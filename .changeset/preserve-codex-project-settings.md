---
"@n-dx/core": patch
---

`n-dx init` preserves project Codex model pins, unrelated settings and operator MCP servers while refreshing n-dx-owned MCP tables.

Action needed: If init reports an unsafe TOML merge, resolve duplicate definitions or express unsupported syntax using ordinary `[table]` definitions and simple keys before rerunning `n-dx init`.

Unreadable, linked or unsupported existing configs are left untouched. Inline tables, array tables, dotted assignments and multiline strings require manual conversion; Claude setup is unchanged.
