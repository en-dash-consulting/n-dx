---
"@n-dx/core": patch
"@n-dx/web": patch
---

Servers are no longer killed by the global `cli.timeoutMs`: `ndx start`, `web`, `dev`, `mcp`, the stdio MCP servers `.mcp.json` registers (`rex mcp`, `sv mcp`), `sv serve`, `graview serve` and `graview mcp` run until stopped unless `cli.timeouts.<command>` names a limit. `ndx graview serve` used to die at the global limit (five hours on this repo) because the timeout keyed only on `graview`. The subcommand is the first positional argument, so `ndx rex -q mcp .` counts as the server too. The dashboard's copy of the rules (`GET /api/cli/timeouts`, and the limit it puts on the analyze, plan and add it spawns) follows core's order and lists `mcp` with the servers.
