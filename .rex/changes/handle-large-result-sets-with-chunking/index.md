---
id: "46f6c6a0-f5c0-4e3c-bfe2-74b25ce959ec"
type: "change"
title: "Handle large result sets with chunking"
slug: "handle-large-result-sets-with-chunking"
intent: "Batch large scan results into multiple LLM calls"
acceptanceCriteria:
  - "Detects when results exceed threshold"
  - "Splits into manageable chunks"
  - "Combines results coherently"
touches:
  - "3bf3754c-c0d0-4fb7-9cbd-5ebbddb85d51"
priority: "low"
source: "llm"
---
