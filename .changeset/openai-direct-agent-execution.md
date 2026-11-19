---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

`n-dx work --provider=api` runs Codex tasks and sequential loops through OpenAI Responses, with guarded tools, budgets, cancellation and completion checks.

Select a supported model (`gpt-6.1-sol` or `gpt-6-astra`) and configure OpenAI API authentication. CLI execution with API-key authentication remains a separate supported option. Direct runs support diff approval; CLI self/pair review remains unavailable on API execution. OpenAI API failover is opt-in through `llm.autoFailover`: Codex light, Claude standard, then Claude light, at most once per selection per run. Claude uses its own API credentials; unsupported OpenAI fallback models are skipped.

The dashboard offers both Codex providers and checks API readiness from the selected authentication mode. API model discovery no longer requires a Codex CLI install.
