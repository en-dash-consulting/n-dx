---
id: "1074c4ff-b1d7-437a-9d3a-570394428e33"
type: "change"
title: "Add vendor-resilient error handling and retry logic for self-heal batch failures"
slug: "add-vendor-resilient-error-handling"
intent: "Ensure that any vendor-specific transient error (rate limit, quota exhaustion, parse failure on partial output) in a self-heal batch is caught and retried with exponential backoff rather than crashing the loop. The retry strategy should be aware of the vendor in use — Codex CLI errors surface differently from Claude API errors — and should log the vendor, batch index, and failure reason before each retry."
acceptanceCriteria:
  - "A Codex-style batch failure (non-zero exit code, malformed stdout) triggers a retry rather than an unhandled exception"
  - "A Claude-style batch failure (HTTP 429, truncated JSON) also triggers the same retry path"
  - "Retry attempts are logged with vendor name, batch index, attempt number, and error summary"
  - "After max retries, the self-heal loop skips the failing batch and continues rather than halting entirely"
amends: [{"target":"e0d22237-06af-4147-a3d7-c3a95c202d59","delta":"modified","summary":"Add vendor-resilient error handling and retry logic for self-heal batch failures","base":"5be54ba3fab6a4521e733780731fecf64cb236d4f8d382cf5d823c680f38d29b"}]
priority: "high"
tags:
  - "self-heal"
  - "codex"
  - "hench"
  - "resilience"
source: "smart-add"
---
