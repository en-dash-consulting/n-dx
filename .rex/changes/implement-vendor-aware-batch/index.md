---
id: "97ec62e7-6687-4152-b6f2-cf6a6afaf858"
type: "change"
title: "Implement vendor-aware batch construction and response handling in self-heal"
slug: "implement-vendor-aware-batch"
intent: "Fix the self-heal batch pipeline so it adapts batch size, prompt format, and response parsing to the active vendor. For Codex, this means using text-based invocation (no tool-use schema), parsing the CLI stdout response format, and respecting Codex context window limits when sizing batches. For Claude, retain current behavior. Use the vendor/model resolver already present in llm-gateway to gate the two paths."
acceptanceCriteria:
  - "Self-heal batches complete without error when the configured vendor is Codex"
  - "Self-heal batches continue to complete without regression when the configured vendor is Claude"
  - "Batch size is bounded by the active vendor's effective context limit, not a Claude-specific constant"
  - "No new Claude-specific assumptions are introduced in the shared batch pipeline code"
amends: [{"target":"e0d22237-06af-4147-a3d7-c3a95c202d59","delta":"modified","summary":"Implement vendor-aware batch construction and response handling in self-heal","base":"5be54ba3fab6a4521e733780731fecf64cb236d4f8d382cf5d823c680f38d29b"}]
priority: "critical"
tags:
  - "self-heal"
  - "codex"
  - "hench"
  - "llm-client"
source: "smart-add"
---
