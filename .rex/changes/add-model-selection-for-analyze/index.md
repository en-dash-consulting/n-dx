---
id: "53558943-22ff-4e1a-b1e8-787b51bb7639"
type: "change"
title: "Add model selection for analyze"
slug: "add-model-selection-for-analyze"
intent: "Support --model flag to override default model"
acceptanceCriteria:
  - "Accepts --model parameter"
  - "Uses specified model for LLM reasoning"
  - "Falls back to default if model unavailable"
amends: [{"target":"3bf3754c-c0d0-4fb7-9cbd-5ebbddb85d51","delta":"modified","summary":"Add model selection for analyze","base":"98bfb0b0fb09499b47f59644b5bc33e051c6dc660bf3e204c8dc968169b895a4"}]
priority: "low"
source: "llm"
---
