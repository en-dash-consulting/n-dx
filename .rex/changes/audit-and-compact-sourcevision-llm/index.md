---
id: "c6bca124-43c6-4d98-96a8-03e86a7870b8"
type: "change"
title: "Audit and compact sourcevision LLM prompt templates"
slug: "audit-and-compact-sourcevision-llm"
intent: "Review every prompt template in the sourcevision analysis pipeline (scan, enrich, findings, next-steps, zone analysis) and rewrite verbose sections to be maximally concise. Remove filler prose, repeated instructions, and redundant context that does not change model behavior. Measure token reduction against current baselines using the existing token tracking infrastructure."
acceptanceCriteria:
  - "Each modified prompt template produces output that passes all existing unit and integration tests unchanged"
  - "Total token count across the standard analysis run decreases measurably (measured via token tracking log)"
  - "No prompt loses an instruction that is required for correct model output — confirmed by running the full test suite"
  - "Prompt diffs are reviewed and documented so future contributors understand what was removed and why"
touches:
  - "ede8a6b4-dff8-4576-abea-3af9fbd7eaba"
priority: "high"
tags:
  - "sourcevision"
  - "llm"
  - "tokens"
  - "prompts"
source: "smart-add"
---
