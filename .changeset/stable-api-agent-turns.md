---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

`n-dx work --provider=api` continues OpenAI reasoning and token-limited turns safely, identifies Claude refusals correctly, and returns cancelled tasks to pending.

Stateless Responses requests ask for encrypted reasoning. JSON and streaming output-token exhaustion retain measured usage and prompt continuation, including reasoning-only responses. Calls and opaque reasoning from truncated turns are discarded; other incomplete or malformed responses fail safely, and truncated context summaries remain rejected.

Opt-in `llm.autoFailover` consumes Codex light, Claude standard and Claude light at most once each per run, with separate credentials and usage attribution. Refusals, malformed output, budget limits and caller aborts do not switch providers. Cancelled OpenAI and Claude API tasks emit `task_cancelled`.

Healthy reasoning/output turns can exceed one minute. Each attempt in this OpenAI-origin chain, including Claude fallbacks, gets two minutes plus `ceil(hench.maxTokens / 10)` seconds, clamped to 10–30 minutes. The deadline covers body reads and primary retries/backoff; secondary calls do not retry. Caller abort wins over timeout. Failover stays off by default.
