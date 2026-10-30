---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

Local-model runs survive a dropped LM Studio connection. A refused or dropped connection to the local server (`fetch failed`, `ECONNREFUSED`, `ECONNRESET`, `UND_ERR_SOCKET`, …) is retried with capped exponential backoff on the provider's blocking and streaming paths and in hench's local tool loop, configured by the new `llm.local.maxRetries` (default 6), `llm.local.retryBaseDelayMs` (default 2000) and `llm.local.retryMaxDelayMs` (default 60000) — about two minutes, long enough for a model reload. When those run out the error is a retryable `ClaudeClientError` with the new reason `"network"`, naming the server, the attempts made and the settings to raise, and hench's local loop retries the turn again on `hench.retry.*` before failing the task. A request that hits `llm.local.timeoutMs` still fails without a retry. The settings are listed and validated by `ndx config`.
