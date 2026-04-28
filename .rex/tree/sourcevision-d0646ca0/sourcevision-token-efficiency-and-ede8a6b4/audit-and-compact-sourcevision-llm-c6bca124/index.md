---
id: "c6bca124-43c6-4d98-96a8-03e86a7870b8"
level: "task"
title: "Audit and compact sourcevision LLM prompt templates"
status: "completed"
priority: "high"
tags:
  - "sourcevision"
  - "llm"
  - "tokens"
  - "prompts"
source: "smart-add"
startedAt: "2026-04-14T15:26:18.744Z"
completedAt: "2026-04-14T15:33:40.705Z"
acceptanceCriteria:
  - "Each modified prompt template produces output that passes all existing unit and integration tests unchanged"
  - "Total token count across the standard analysis run decreases measurably (measured via token tracking log)"
  - "No prompt loses an instruction that is required for correct model output — confirmed by running the full test suite"
  - "Prompt diffs are reviewed and documented so future contributors understand what was removed and why"
description: "Review every prompt template in the sourcevision analysis pipeline (scan, enrich, findings, next-steps, zone analysis) and rewrite verbose sections to be maximally concise. Remove filler prose, repeated instructions, and redundant context that does not change model behavior. Measure token reduction against current baselines using the existing token tracking infrastructure."
---
