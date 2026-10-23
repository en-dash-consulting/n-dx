---
id: "8474f71e-41ac-4d6f-b963-77c8f7a91d85"
type: "change"
title: "Trim and deduplicate LLM data payloads in sourcevision analysis"
slug: "trim-and-deduplicate-llm-data-payloads"
intent: "Identify data structures assembled before each LLM call in the sourcevision pipeline — file inventory summaries, import graph excerpts, zone descriptions, findings lists — and remove fields that are duplicated, unused by the model, or trivially derivable. Apply deduplication where the same content appears multiple times across a single prompt context. Goal is to shrink prompt context size without altering which information the model receives."
acceptanceCriteria:
  - "All existing tests pass without modification after payload changes"
  - "No field removal causes a regression in findings quality detectable by the test suite"
  - "Token usage for a representative analysis run decreases compared to the pre-change baseline"
  - "Removed or deduplicated fields are documented with rationale in the relevant source files"
touches:
  - "ede8a6b4-dff8-4576-abea-3af9fbd7eaba"
priority: "high"
tags:
  - "sourcevision"
  - "llm"
  - "tokens"
  - "data"
source: "smart-add"
---
