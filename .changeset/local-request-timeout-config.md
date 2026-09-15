---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

Make the local (LM Studio) per-request timeout configurable via `llm.local.timeoutMs`

Local completions were bounded by a hardcoded 5-minute abort in three places — the
local API provider, hench's local tool loop, and the second-model verifier (60 s) —
so a slow local model failed with `NDX_CLI_TIMEOUT` no matter what the CLI-timeout
settings said. `cli.timeoutMs` / the "CLI Timeouts" page bound a whole command, not
an individual HTTP request, so setting them to unlimited had no effect on this path.

All three now read `llm.local.timeoutMs` (default 300000, `0` = no timeout), settable
via `ndx config llm.local.timeoutMs <ms>` or the LLM Provider settings page. The
timeout error message now names the key to change.
