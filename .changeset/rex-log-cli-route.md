---
"@n-dx/rex": patch
"@n-dx/core": patch
---

Add `rex log` / `ndx log` as a CLI route for `append_log`.

`append_log` was reachable only as a rex MCP tool. Every `ndx work` run in a
recent measured batch reported the same gap: the workflow's log step asks the
agent to call it, but the rex MCP server was not connected to any of those
sessions, and rex owns `execution-log.jsonl` under the write-access protocol,
so hand-writing the file is not a substitute. Each run put the detail in its
commit message instead.

`rex log <event> [--item=<id>] [--detail="..."]` and the `append_log` MCP tool
now build their entry through the same `appendExecutionLogEntry` and persist
it via the same `PRDStore#appendLog`, so the two routes cannot diverge on
shape, truncation (2,000 characters), or rotation (`execution-log.1.jsonl`
past 1 MB). `ndx log` in `packages/core` spawns `rex log` — no rex import,
same as every other delegated command.

rex's default workflow and the `ndx-work` skill now name `ndx log` as the
route when no rex MCP server is connected — the ordinary case for a
`claude`/`codex` CLI-provider run.
