---
"@n-dx/rex": patch
---

A saved `run` block can no longer carry `permissionMode: "bypassPermissions"` — the validator refuses it and says where the mode belongs — and the `add_item` and `edit_item` MCP tools, like `rex update --run`, refuse to save a `run` block while `NDX_AGENT_RUN` is set (removing one is still allowed).
