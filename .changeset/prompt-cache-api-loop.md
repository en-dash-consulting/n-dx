---
"@n-dx/hench": patch
"@n-dx/web": patch
---

Cache the Anthropic API agent loop's stable prompt prefix.

The API-mode turn loop re-sent the system prompt, every tool definition and the
whole conversation at full input price on every turn. It now places two ephemeral
`cache_control` breakpoints per request: one on the system block, which covers
the tool definitions because tools precede system in Anthropic's cacheable
prefix, and one on the trailing conversation boundary, which moves forward each
turn so the next request extends the cached prefix instead of re-sending it.
`cache_creation_input_tokens` / `cache_read_input_tokens` were already parsed and
aggregated, so `ndx usage` and `hench show` start reporting cache activity with
no further change. The CLI, Gemini and OpenAI-compatible paths are untouched.

Also fixes a `routes-commands` test that read the ambient `NDX_CLI_PATH`, so the
web suite no longer fails when run from inside an `ndx` invocation.
