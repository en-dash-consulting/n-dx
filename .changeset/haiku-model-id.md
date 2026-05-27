---
"@n-dx/llm-client": patch
---

Correct the haiku model id. `TIER_MODELS.claude.light` and
`MODEL_ALIASES.haiku` referenced `claude-haiku-4-20250414`, which doesn't
exist — the API returns 404, but the Claude CLI provider hangs silently
on the bad id instead of erroring. That caused dashboard Quick Add (which
forces the light tier via `--fast`) to time out at 240 s with zero
output. Updated to the dateless alias `claude-haiku-4-5` (matching the
existing pattern used for `opus`/`sonnet`); it resolves to the latest
Haiku 4.5 release without pinning to a snapshot that will eventually be
deprecated.
