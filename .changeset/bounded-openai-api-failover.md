---
"@n-dx/hench": patch
---

`n-dx work` retries OpenAI API runs through configured fallback models and Claude when `llm.autoFailover` is enabled.

The run consumes at most three fallback selections, checks token and spend limits before each attempt, and keeps each provider's credentials and tool format separate. Usage is attributed to the effective model. Exhaustion restores the original selection and error; cancellation and non-retryable failures stop immediately. Failover remains off by default.
