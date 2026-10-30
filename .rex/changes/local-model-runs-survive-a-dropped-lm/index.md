---
id: "bdc6b380-31b1-454a-baed-bcf3e59501e1"
type: "change"
title: "Local-model runs survive a dropped LM Studio connection"
slug: "local-model-runs-survive-a-dropped-lm"
intent: "Seen while running ndx work against LM Studio (openai/gpt-oss-20b): 'Cannot reach local server at http://localhost:1234/v1: fetch failed' failed a task on turn 12. llm-client/src/local-api-provider.ts retries a network error only 3 times at 1, 2 and 4 seconds (about 7 s) and then throws ClaudeClientError(..., 'unknown', false), so it is not retryable and hench.retry.* never applies; a model reload or a short server restart in LM Studio outlasts that window. Fix: treat network errors (fetch failed, ECONNRESET, ECONNREFUSED, UND_ERR_SOCKET) as retryable, and add llm.local.maxRetries and llm.local.retryBaseDelayMs with a default backoff long enough to survive a model reload (minutes, capped), documented in ndx config --help."
acceptanceCriteria:
  - "A local completion whose server is unreachable for 60 s, then answers, succeeds without failing the task (test with a fake server)"
  - "Network errors from the local provider are marked retryable, so hench.retry.* applies to them"
  - "llm.local.maxRetries and llm.local.retryBaseDelayMs are read from config and listed in ndx config --help"
  - "When retries run out, the error names the server, the attempts made and the settings to raise"
touches:
  - "2e136c81-64ea-4b4f-96ad-d070f98665e1"
priority: "high"
source: "ndx-capture"
---
