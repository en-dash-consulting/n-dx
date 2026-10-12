---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Claude Code CLI runs now honour `llm.effort`, passing it as `--effort <level>`.

The Messages API paths have sent `llm.effort` as `output_config.effort` since
the effort work landed, but CLI runs dropped it: the llm-client CLI provider
ignored `CompletionRequest.effort` and hench's CLI agent loop passed no
`--effort` at all. A project that set `llm.effort` got it on API runs and
silently not on CLI runs.

Both now resolve through `resolveClaudeCliEffort`, which shares the API path's
validation — an unknown level or a model that does not accept effort is
dropped with the same warning — and stops before its per-model default.
`CLAUDE_DEFAULT_EFFORT` exists to hold the API's heavy tier at the depth it
had before Opus 5.5 lowered its own API default; Claude Code picks its own
default per model, so sending ours unasked would override that choice on every
run nobody configured. With no rule matched the flag is omitted and the CLI
decides.

`agent/lifecycle/api-effort.ts` is now `agent-effort.ts`, since it serves both
of hench's loops.
