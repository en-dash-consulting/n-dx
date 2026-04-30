---
id: "1074c4ff-b1d7-437a-9d3a-570394428e33"
level: "task"
title: "Add vendor-resilient error handling and retry logic for self-heal batch failures"
status: "completed"
priority: "high"
tags:
  - "self-heal"
  - "codex"
  - "hench"
  - "resilience"
source: "smart-add"
startedAt: "2026-04-14T21:28:44.422Z"
completedAt: "2026-04-14T21:36:07.371Z"
acceptanceCriteria:
  - "A Codex-style batch failure (non-zero exit code, malformed stdout) triggers a retry rather than an unhandled exception"
  - "A Claude-style batch failure (HTTP 429, truncated JSON) also triggers the same retry path"
  - "Retry attempts are logged with vendor name, batch index, attempt number, and error summary"
  - "After max retries, the self-heal loop skips the failing batch and continues rather than halting entirely"
description: "Ensure that any vendor-specific transient error (rate limit, quota exhaustion, parse failure on partial output) in a self-heal batch is caught and retried with exponential backoff rather than crashing the loop. The retry strategy should be aware of the vendor in use — Codex CLI errors surface differently from Claude API errors — and should log the vendor, batch index, and failure reason before each retry."
---

# Add vendor-resilient error handling and retry logic for self-heal batch failures

🟠 [completed]

## Summary

Ensure that any vendor-specific transient error (rate limit, quota exhaustion, parse failure on partial output) in a self-heal batch is caught and retried with exponential backoff rather than crashing the loop. The retry strategy should be aware of the vendor in use — Codex CLI errors surface differently from Claude API errors — and should log the vendor, batch index, and failure reason before each retry.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** self-heal, codex, hench, resilience
- **Level:** task
- **Started:** 2026-04-14T21:28:44.422Z
- **Completed:** 2026-04-14T21:36:07.371Z
- **Duration:** 7m
