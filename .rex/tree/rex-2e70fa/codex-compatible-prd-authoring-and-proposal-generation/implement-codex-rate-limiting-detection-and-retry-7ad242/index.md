---
id: "7ad24227-1245-46bf-99e5-7ece2f6aca8c"
level: "task"
title: "Implement Codex rate limiting detection and retry in rex LLM call paths"
status: "completed"
priority: "high"
tags:
  - "codex"
  - "token-usage"
  - "tests"
  - "tokens"
source: "smart-add"
startedAt: "2026-04-16T16:54:20.429Z"
completedAt: "2026-04-16T21:29:18.611Z"
resolutionType: "code-change"
resolutionDetail: "Added onRetry callback to CodexCliProviderOptions and CliProviderOptions. Default writes 'Rate limited — retrying in Xs… (attempt N of M)' to stderr before each rate-limit retry sleep. After exhausting retries on rate-limit, throws actionable ClaudeClientError with guidance instead of raw provider message. Added 4 targeted tests in codex-cli-provider.test.ts."
acceptanceCriteria:
  - "Rate limit responses from Codex are detected and classified separately from hard errors"
  - "LLM call paths retry automatically with exponential backoff on a detected rate limit"
  - "User sees a retry progress message (e.g., 'Rate limited — retrying in Xs…') during backoff"
  - "Command exits with a clear actionable error after max retries are exceeded"
  - "Retry logic does not fire on non-rate-limit errors (e.g., auth failures, parse errors)"
description: "Add explicit detection of Codex rate limit responses (HTTP 429 and equivalent CLI-level error messages) across all rex LLM call sites, including rex add, rex analyze, and rex recommend. Implement exponential backoff retry logic so transient rate limits do not abort the command outright. Surface a clear in-progress message to the user during retries and exit with actionable guidance after the retry budget is exhausted."
---

# Implement Codex rate limiting detection and retry in rex LLM call paths

🟠 [completed]

## Summary

Add explicit detection of Codex rate limit responses (HTTP 429 and equivalent CLI-level error messages) across all rex LLM call sites, including rex add, rex analyze, and rex recommend. Implement exponential backoff retry logic so transient rate limits do not abort the command outright. Surface a clear in-progress message to the user during retries and exit with actionable guidance after the retry budget is exhausted.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** codex, token-usage, tests, tokens
- **Level:** task
- **Started:** 2026-04-16T16:54:20.429Z
- **Completed:** 2026-04-16T21:29:18.611Z
- **Duration:** 4h 34m
