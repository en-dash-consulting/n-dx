---
"@n-dx/llm-client": patch
---

Correct the haiku model id. `TIER_MODELS.claude.light` and
`MODEL_ALIASES.haiku` referenced `claude-haiku-4-20250414`, which doesn't
exist — the API returns 404, but the Claude CLI provider hangs silently
on the bad id instead of erroring. That caused dashboard Quick Add (which
forces the light tier via `--fast`) to time out at 240 s with zero
output. Updated to the actual current id `claude-haiku-4-5-20251001`
(Haiku 4.5).
