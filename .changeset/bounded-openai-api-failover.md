---
"@n-dx/hench": patch
---

`n-dx work` retries OpenAI API runs through configured fallback models and Claude when `llm.autoFailover` is enabled.

The run consumes at most three fallback selections, checks token and spend limits before each attempt, and keeps each provider's credentials and tool format separate. Usage is attributed to the effective model. Exhaustion restores the original selection and error; cancellation, refusals, malformed output and budget limits stop immediately. Authentication and unavailable-model failures may advance the chain. Failover remains off by default.

Each attempt in the OpenAI-origin chain, including Claude fallbacks, gets two minutes plus `ceil(hench.maxTokens / 10)` seconds, clamped to 10–30 minutes. The deadline covers response bodies and primary retries/backoff; secondary clients do not retry. Caller abort takes precedence over timeout.
