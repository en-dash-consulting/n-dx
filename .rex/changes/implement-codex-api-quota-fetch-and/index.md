---
id: "208d645e-27e5-47bb-a1bf-db3e69d80361"
type: "change"
title: "Implement Codex API quota fetch and normalize response to QuotaRemaining"
slug: "implement-codex-api-quota-fetch-and"
intent: "Make a live HTTP request to the Codex (OpenAI) usage/quota endpoint between hench runs to retrieve the current consumption and hard limit for the authenticated account. Parse the response and map it to the existing QuotaRemaining typed interface so downstream formatters and log integrations receive a consistent shape regardless of provider. This is distinct from the budget-based percent calculation (which derives limits from configured values) — this task fetches real-time quota directly from the provider API."
acceptanceCriteria:
  - "An HTTP call is made to the Codex quota or usage endpoint using the configured API key before each inter-run log line"
  - "The raw Codex response is parsed and mapped to the existing QuotaRemaining interface (tokens used, tokens limit, percent remaining)"
  - "A network or auth failure returns a typed error result rather than throwing, allowing the caller to degrade gracefully"
  - "The fetch function is unit-tested with mocked HTTP responses covering success, rate-limit, and auth-failure cases"
  - "No Codex-specific types leak past the adapter boundary — callers receive only QuotaRemaining or a typed error"
amends: [{"target":"642df761-d076-4309-bd5c-edba76604dfd","delta":"modified","summary":"Implement Codex API quota fetch and normalize response to QuotaRemaining","base":"729f559c0f66f8d68a92209c7e30f7dbf188c0e34ff28c73b2830c815f13747f"}]
priority: "high"
tags:
  - "llm"
  - "codex"
  - "quota"
  - "api"
source: "smart-add"
---
