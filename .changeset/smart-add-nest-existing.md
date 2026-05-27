---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Smart-add fixes — nesting, dashboard Quick Add, and clearer errors.

**Nesting (rex):** `n-dx add` no longer creates a duplicate epic when the work
belongs under an existing one. The LLM was supposed to set `existingId` for
placement under an existing epic/feature but often omitted it. Added a
deterministic post-generation pass that matches proposed epics/features
against existing PRD containers (high-confidence, title-based) and fills
`existingId` so the new task nests instead of duplicating. Respects an
`existingId` the LLM already set; skipped when an explicit `--parent` is
given.

**Dashboard Quick Add latency (rex + web):** new `--fast` flag for `rex add`
forces the vendor's light tier (haiku for Claude, gpt-5.4-mini for Codex) so
the CLI provider completes well within the timeout from a daemonized server.
The web Quick Add preview now passes `--fast`; the user-driven CLI
`n-dx add` is unchanged.

**Timeout error message (web):** the smart-add timeout no longer wrongly
implies "set an API key" is the fix — the Claude CLI provider is a valid
first-class path. The message now points at the right diagnostic
(`time claude -p`), notes an API key is only an optional speed-up, and
appends captured stderr when present.
