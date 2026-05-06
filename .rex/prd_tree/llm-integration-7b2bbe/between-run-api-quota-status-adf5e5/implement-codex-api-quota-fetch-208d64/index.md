---
id: "208d645e-27e5-47bb-a1bf-db3e69d80361"
level: "task"
title: "Implement Codex API quota fetch and normalize response to QuotaRemaining"
status: "completed"
priority: "high"
tags:
  - "llm"
  - "codex"
  - "quota"
  - "api"
source: "smart-add"
startedAt: "2026-04-08T18:39:57.135Z"
completedAt: "2026-04-08T19:28:19.337Z"
acceptanceCriteria:
  - "An HTTP call is made to the Codex quota or usage endpoint using the configured API key before each inter-run log line"
  - "The raw Codex response is parsed and mapped to the existing QuotaRemaining interface (tokens used, tokens limit, percent remaining)"
  - "A network or auth failure returns a typed error result rather than throwing, allowing the caller to degrade gracefully"
  - "The fetch function is unit-tested with mocked HTTP responses covering success, rate-limit, and auth-failure cases"
  - "No Codex-specific types leak past the adapter boundary — callers receive only QuotaRemaining or a typed error"
description: "Make a live HTTP request to the Codex (OpenAI) usage/quota endpoint between hench runs to retrieve the current consumption and hard limit for the authenticated account. Parse the response and map it to the existing QuotaRemaining typed interface so downstream formatters and log integrations receive a consistent shape regardless of provider. This is distinct from the budget-based percent calculation (which derives limits from configured values) — this task fetches real-time quota directly from the provider API."
---

# Implement Codex API quota fetch and normalize response to QuotaRemaining

🟠 [completed]

## Summary

Make a live HTTP request to the Codex (OpenAI) usage/quota endpoint between hench runs to retrieve the current consumption and hard limit for the authenticated account. Parse the response and map it to the existing QuotaRemaining typed interface so downstream formatters and log integrations receive a consistent shape regardless of provider. This is distinct from the budget-based percent calculation (which derives limits from configured values) — this task fetches real-time quota directly from the provider API.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** llm, codex, quota, api
- **Level:** task
- **Started:** 2026-04-08T18:39:57.135Z
- **Completed:** 2026-04-08T19:28:19.337Z
- **Duration:** 48m
