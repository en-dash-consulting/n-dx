---
"@n-dx/hench": patch
---

Make Codex quota/token reporting behave sanely under `codex login` (session auth). The quota path required `OPENAI_API_KEY` and matched usage by exact model id, which broke the primary Codex auth flow — session auth never sets an API key (the CLI provider even deletes it), so quota was silently skipped and token retrieval returned not-found for real accounts.

- **Session-auth quota notice:** when Codex is the active vendor and no API key is present, `checkQuotaRemaining` now surfaces a clear `quota unavailable — codex login (session auth) — set OPENAI_API_KEY or llm.codex.api_key for quota` entry instead of silently emitting nothing. `QuotaRemaining` gains an optional `notice` field rendered by `formatQuotaLog`.
- **Dated deployment ids:** Codex token retrieval now matches the OpenAI usage `model` field tolerantly (`modelMatches`/`stripModelDateSuffix`), so dated deployment ids such as `gpt-5-codex-2025-03-01` resolve to the configured base id `gpt-5-codex`. Matching uses equality after date-stripping, so prefix-sharing models (`gpt-4o` vs `gpt-4o-mini`) never collide.
