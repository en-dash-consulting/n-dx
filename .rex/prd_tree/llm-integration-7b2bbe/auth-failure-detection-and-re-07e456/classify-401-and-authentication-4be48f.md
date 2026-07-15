---
id: "4be48f7d-423b-48fc-805c-52e6dfeff354"
level: "task"
title: "Classify 401 and authentication errors from LLM provider preflight as a distinct typed error"
status: "completed"
priority: "high"
tags:
  - "auth"
  - "llm"
  - "error-handling"
source: "smart-add"
startedAt: "2026-07-08T17:30:42.314Z"
completedAt: "2026-07-08T17:49:05.081Z"
endedAt: "2026-07-08T17:49:05.081Z"
acceptanceCriteria:
  - "A 401 response or 'authentication_error' from any provider preflight is classified as AuthFailureError, not a generic CLI error"
  - "AuthFailureError carries the provider name, HTTP status, and a normalized human-readable reason extracted from the payload"
  - "Raw JSON blobs are never emitted to the console as part of auth error output"
  - "Existing rate-limit and token-exhaustion classifiers are not regressed by this change"
  - "Unit tests cover 401, expired-token, and invalid-key scenarios for Claude and Google providers"
description: "The current preflight error path emits the raw CLI output (including a full JSON payload) when the Claude CLI returns api_error_status:401 or when any provider returns an auth error. This task adds structured detection by parsing provider error payloads to identify auth failures (401, invalid_api_key, authentication_error) and mapping them to a shared AuthFailureError type — distinct from network errors, rate-limit errors, and quota exhaustion. The existing shared error classifier from the token-exhaustion work is the right extension point."
---
