---
"@n-dx/core": patch
"@n-dx/rex": patch
"@n-dx/llm-client": patch
---

`ndx migrate --plan` shows the preflight banner and a run summary that lists the `--out` plan as written and says model calls are not counted. `llm.routes` for `prd.migrate.judge` (or `*`) turns the Jev review off.

Adds a config key under the soft freeze: `llm.routes` accepts `prd.migrate.judge` (the migration's Jev review), and a route to a tier turns that review off. `ndx migrate --plan` prints the preflight banner and run summary. No flag or MCP tool changes shape.

On Windows, the guard that keeps `rex export`, `rex migrate-plan --out`/`--summary` and `rex tree-diff` from writing inside the rex directory now sees through 8.3 short-name aliases such as `RUNNER~1`. It resolved paths with `fs.realpathSync`, which leaves short names unexpanded, so a project or output path written in short form slipped past the check. It now uses `realpathSync.native`; macOS and Linux behave as before.

Fixes a CLI guard under the soft freeze (Windows only): the same commands refuse a path they already meant to refuse. No flag or MCP tool changes shape.
