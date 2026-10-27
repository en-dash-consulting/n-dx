---
id: "f61ca69b-1aba-4e71-b9df-121025c37d70"
type: "change"
title: "Add rate-limit cooldown detection with retry-after countdown and timeout state messaging"
slug: "add-rate-limit-cooldown-detection-with"
intent: "When the LLM API returns a 429 with a Retry-After header or the user is in a rate-limit cooldown window, commands should detect this proactively (not just reactively after a failed call). The Anthropic API and Codex API both return rate-limit headers that indicate when the user can retry. Commands should parse this, display a human-readable countdown ('Rate limited — retry available in 47s'), and optionally auto-retry if the wait is short (< 60s configurable). For timeout errors (request took too long), commands should distinguish between network timeouts and API processing timeouts and suggest appropriate actions (retry vs. reduce input size)."
acceptanceCriteria:
  - "Rate-limit responses with Retry-After header display countdown in human-readable format (e.g., 'Rate limited — retry in 47s')"
  - "Commands auto-retry once if Retry-After is under the configurable threshold (default 60s) with a visible waiting indicator"
  - "Timeout errors distinguish network timeout ('Check your connection') from API timeout ('Try reducing input size or using a smaller model')"
  - "When token budget is fully exhausted, error message shows current usage vs. budget and the ndx config command to increase it"
  - "All error messages include the command that failed and the vendor/model that was in use at the time of failure"
  - "Unit tests verify retry-after parsing, countdown formatting, and auto-retry threshold logic"
amends: [{"target":"0d84e500-04a1-4186-a4ea-6cf98d305920","delta":"modified","summary":"Add rate-limit cooldown detection with retry-after countdown and timeout state messaging","base":"6100817686797d710037673ce6f2234e5cb05a8a6fddd82d6b910c4ca39f1605"}]
priority: "medium"
tags:
  - "llm"
  - "error-handling"
  - "ux"
source: "smart-add"
---
