---
id: "97ec62e7-6687-4152-b6f2-cf6a6afaf858"
level: "task"
title: "Implement vendor-aware batch construction and response handling in self-heal"
status: "completed"
priority: "critical"
tags:
  - "self-heal"
  - "codex"
  - "hench"
  - "llm-client"
source: "smart-add"
startedAt: "2026-04-14T21:05:57.971Z"
completedAt: "2026-04-14T21:20:02.251Z"
acceptanceCriteria:
  - "Self-heal batches complete without error when the configured vendor is Codex"
  - "Self-heal batches continue to complete without regression when the configured vendor is Claude"
  - "Batch size is bounded by the active vendor's effective context limit, not a Claude-specific constant"
  - "No new Claude-specific assumptions are introduced in the shared batch pipeline code"
description: "Fix the self-heal batch pipeline so it adapts batch size, prompt format, and response parsing to the active vendor. For Codex, this means using text-based invocation (no tool-use schema), parsing the CLI stdout response format, and respecting Codex context window limits when sizing batches. For Claude, retain current behavior. Use the vendor/model resolver already present in llm-gateway to gate the two paths."
---
