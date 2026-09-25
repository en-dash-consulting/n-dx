---
"@n-dx/hench": patch
---

Count the per-run MCP config as hench's own runtime state, not operator work.

0.7.1 began writing `.hench/mcp/<runId>.json` for every Claude-vendor run but
left it out of `HENCH_RUNTIME_GITIGNORE_ENTRIES`, the list the pre-run, loop and
completion gates discount. In any project whose `.gitignore` did not already
name `.hench/mcp/`, the file read back as the run's own uncommitted work: the
completion was refused and the task reset to pending, and because the config is
swept by age rather than at run end, the next run could be refused too.

Workaround on 0.7.1: add `.hench/mcp/` to the project's `.gitignore`.
