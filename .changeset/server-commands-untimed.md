---
"@n-dx/core": patch
"@n-dx/web": patch
---

Servers are no longer killed by the global `cli.timeoutMs`: `ndx start`, `web`, `dev`, `mcp`, the stdio MCP servers `.mcp.json` registers (`rex mcp`, `sv mcp`), `sv serve`, `graview serve` and `graview mcp` run until stopped unless `cli.timeouts.<command>` names a limit. `ndx graview serve` used to die at the global limit (five hours on this repo) because the timeout keyed only on `graview`. The subcommand is the first word that is not a flag or a flag's value, so `ndx rex -q mcp .` and `ndx rex --format json mcp .` count as the server too. The dashboard's copy of the rules (`GET /api/cli/timeouts`, the limit it puts on the analyze, plan and add it spawns, and a Sidecar `run_command`) follows core's order, lists `mcp` with the servers and applies the same server subcommands, so `ndx graview serve` or `ndx sv serve` run from the dashboard are not cut off either.
