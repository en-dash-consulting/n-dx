---
"@n-dx/core": minor
---

`ndx init` no longer registers Claude MCP servers via `claude mcp add --scope local` by default — it relies solely on the tracked, cwd-relative `.mcp.json` written alongside it. Pass `--mcp-scope=local` to restore the local-scope registration for setups that cannot rely on `.mcp.json` being picked up.

Init also no longer calls `claude mcp remove --scope user` — user scope is global, and stripping it removed registrations that had nothing to do with the project being initialised. Stale local-scope entries from a prior run are still cleaned up, but only when the existing entry's own recorded arguments actually target the project being initialised.

The init recap now reports where MCP registration landed — tracked `.mcp.json`, local scope, or skipped (no `claude` CLI found).
