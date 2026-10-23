---
id: "3a80b875-f796-476f-b456-912b2ae1604a"
type: "change"
title: "Invoke the reviewer LLM with a validation-only constraint prompt"
slug: "invoke-the-reviewer-llm-with-a"
intent: "The current cross-vendor review step only runs the project's shell test command — it never invokes the reviewer LLM. The reviewer should be called via its CLI with a targeted prompt that instructs it to: check the changed files for syntax and logic errors, run the test command, and report findings. Critically, the reviewer's prompt must constrain it to small, targeted fixes only (e.g. fixing a broken import or a one-line syntax error) and must explicitly prohibit large refactors or architectural changes. This keeps the reviewer in a QA role rather than turning it into a second implementer."
acceptanceCriteria:
  - "The reviewer vendor CLI is invoked with an LLM prompt after the primary completes, not just a shell test run"
  - "The reviewer prompt explicitly instructs the model to validate only and limit changes to under 20 lines across any single file"
  - "The reviewer prompt includes the list of files modified by the primary run (sourced from the work summary or git diff)"
  - "If the reviewer CLI is unavailable the step is skipped with a warning, preserving existing behavior"
  - "The review banner distinguishes between LLM-review-passed, shell-test-only-passed, and skipped states"
touches:
  - "8a8661f8-f768-412e-afda-f603f604f2fb"
priority: "high"
tags:
  - "pair-programming"
  - "review"
  - "llm"
source: "smart-add"
---
