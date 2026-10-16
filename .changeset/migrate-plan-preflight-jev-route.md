---
"@n-dx/core": patch
"@n-dx/rex": patch
"@n-dx/llm-client": patch
---

`ndx migrate --plan` shows the preflight banner and a run summary that lists the `--out` plan as written and says model calls are not counted. `llm.routes` for `prd.migrate.judge` (or `*`) turns the Jev review off.

Adds a config key under the soft freeze: `llm.routes` accepts `prd.migrate.judge` (the migration's Jev review), and a route to a tier turns that review off. `ndx migrate --plan` prints the preflight banner and run summary. No flag or MCP tool changes shape.
