---
id: "7ad24227-1245-46bf-99e5-7ece2f6aca8c"
type: "change"
title: "Implement Codex rate limiting detection and retry in rex LLM call paths"
slug: "implement-codex-rate-limiting"
intent: "Add explicit detection of Codex rate limit responses (HTTP 429 and equivalent CLI-level error messages) across all rex LLM call sites, including rex add, rex analyze, and rex recommend. Implement exponential backoff retry logic so transient rate limits do not abort the command outright. Surface a clear in-progress message to the user during retries and exit with actionable guidance after the retry budget is exhausted."
acceptanceCriteria:
  - "Rate limit responses from Codex are detected and classified separately from hard errors"
  - "LLM call paths retry automatically with exponential backoff on a detected rate limit"
  - "User sees a retry progress message (e.g., 'Rate limited — retrying in Xs…') during backoff"
  - "Command exits with a clear actionable error after max retries are exceeded"
  - "Retry logic does not fire on non-rate-limit errors (e.g., auth failures, parse errors)"
amends: [{"target":"089d9bc8-d815-4227-85d4-5c53d0621985","delta":"modified","summary":"Implement Codex rate limiting detection and retry in rex LLM call paths","base":"dcacddca80b6043a4eb0c8375cfcf9493b1d420f1add774e7dc6f2f91fcd041b"}]
priority: "high"
tags:
  - "codex"
  - "token-usage"
  - "tests"
  - "tokens"
source: "smart-add"
---
