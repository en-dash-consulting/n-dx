---
"@n-dx/web": patch
---

GET /api/status and GET /api/config now include a `server` object — `projectDir`,
`version`, `cliPath`, `pid`, `port`, `startedAt` — identifying the running dashboard
process itself, not just the project it serves. `version` and `cliPath` come from the
same resolution the dashboard already uses to spawn `ndx` commands (`@n-dx/web`'s own
`package.json`, and the `NDX_CLI_PATH`/`N_DX_CLI_PATH` env vars set by `cli.js`), so
`ndx which`/the viewer footer can report them without re-deriving them. Purely
additive: existing fields on both routes are unchanged.
