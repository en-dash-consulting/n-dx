---
"@n-dx/core": patch
---

Servers are no longer killed by the global `cli.timeoutMs`: `ndx start`, `web`, `dev`, `mcp`, the stdio MCP servers `.mcp.json` registers (`rex mcp`, `sv mcp`), `sv serve`, `graview serve` and `graview mcp` run until stopped unless `cli.timeouts.<command>` names a limit. `ndx graview serve` used to die at the global limit (five hours on this repo) because the timeout keyed only on `graview`.
