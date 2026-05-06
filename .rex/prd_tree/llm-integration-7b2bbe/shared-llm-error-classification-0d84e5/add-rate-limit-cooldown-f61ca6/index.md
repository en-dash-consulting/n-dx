---
id: "f61ca69b-1aba-4e71-b9df-121025c37d70"
level: "task"
title: "Add rate-limit cooldown detection with retry-after countdown and timeout state messaging"
status: "completed"
priority: "medium"
tags:
  - "llm"
  - "error-handling"
  - "ux"
source: "smart-add"
startedAt: "2026-04-21T17:24:02.504Z"
completedAt: "2026-04-21T17:39:33.708Z"
resolutionType: "code-change"
resolutionDetail: "Added rate-limit.ts with Retry-After header parsing, countdown formatting, auto-retry threshold, SDK error extraction, and timeout classification. Enhanced ClaudeClientError with retryAfterMs field. Updated API provider to extract Retry-After from SDK errors, honor it for delays, and surface onRetry callback. Enhanced classifyLLMError with LLMErrorContext for command/vendor/model suffixes, structured retryAfterSeconds countdown, budget usage vs limit display, and network vs API timeout distinction. 43 new unit tests, 3 downstream test updates."
acceptanceCriteria:
  - "Rate-limit responses with Retry-After header display countdown in human-readable format (e.g., 'Rate limited — retry in 47s')"
  - "Commands auto-retry once if Retry-After is under the configurable threshold (default 60s) with a visible waiting indicator"
  - "Timeout errors distinguish network timeout ('Check your connection') from API timeout ('Try reducing input size or using a smaller model')"
  - "When token budget is fully exhausted, error message shows current usage vs. budget and the ndx config command to increase it"
  - "All error messages include the command that failed and the vendor/model that was in use at the time of failure"
  - "Unit tests verify retry-after parsing, countdown formatting, and auto-retry threshold logic"
description: "When the LLM API returns a 429 with a Retry-After header or the user is in a rate-limit cooldown window, commands should detect this proactively (not just reactively after a failed call). The Anthropic API and Codex API both return rate-limit headers that indicate when the user can retry. Commands should parse this, display a human-readable countdown ('Rate limited — retry available in 47s'), and optionally auto-retry if the wait is short (< 60s configurable). For timeout errors (request took too long), commands should distinguish between network timeouts and API processing timeouts and suggest appropriate actions (retry vs. reduce input size)."
---

# Add rate-limit cooldown detection with retry-after countdown and timeout state messaging

🟡 [completed]

## Summary

When the LLM API returns a 429 with a Retry-After header or the user is in a rate-limit cooldown window, commands should detect this proactively (not just reactively after a failed call). The Anthropic API and Codex API both return rate-limit headers that indicate when the user can retry. Commands should parse this, display a human-readable countdown ('Rate limited — retry available in 47s'), and optionally auto-retry if the wait is short (< 60s configurable). For timeout errors (request took too long), commands should distinguish between network timeouts and API processing timeouts and suggest appropriate actions (retry vs. reduce input size).

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** llm, error-handling, ux
- **Level:** task
- **Started:** 2026-04-21T17:24:02.504Z
- **Completed:** 2026-04-21T17:39:33.708Z
- **Duration:** 15m
