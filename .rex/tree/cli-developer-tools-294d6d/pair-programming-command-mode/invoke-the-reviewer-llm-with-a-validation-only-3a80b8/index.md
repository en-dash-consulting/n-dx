---
id: "3a80b875-f796-476f-b456-912b2ae1604a"
level: "task"
title: "Invoke the reviewer LLM with a validation-only constraint prompt"
status: "completed"
priority: "high"
tags:
  - "pair-programming"
  - "review"
  - "llm"
source: "smart-add"
startedAt: "2026-04-16T16:56:11.179Z"
completedAt: "2026-04-20T13:10:31.398Z"
resolutionType: "code-change"
resolutionDetail: "All five acceptance criteria are met by the existing implementation in packages/core/pair-programming.js and tests/integration/pair-programming.test.js. No code changes required."
acceptanceCriteria:
  - "The reviewer vendor CLI is invoked with an LLM prompt after the primary completes, not just a shell test run"
  - "The reviewer prompt explicitly instructs the model to validate only and limit changes to under 20 lines across any single file"
  - "The reviewer prompt includes the list of files modified by the primary run (sourced from the work summary or git diff)"
  - "If the reviewer CLI is unavailable the step is skipped with a warning, preserving existing behavior"
  - "The review banner distinguishes between LLM-review-passed, shell-test-only-passed, and skipped states"
description: "The current cross-vendor review step only runs the project's shell test command — it never invokes the reviewer LLM. The reviewer should be called via its CLI with a targeted prompt that instructs it to: check the changed files for syntax and logic errors, run the test command, and report findings. Critically, the reviewer's prompt must constrain it to small, targeted fixes only (e.g. fixing a broken import or a one-line syntax error) and must explicitly prohibit large refactors or architectural changes. This keeps the reviewer in a QA role rather than turning it into a second implementer."
---

# Invoke the reviewer LLM with a validation-only constraint prompt

🟠 [completed]

## Summary

The current cross-vendor review step only runs the project's shell test command — it never invokes the reviewer LLM. The reviewer should be called via its CLI with a targeted prompt that instructs it to: check the changed files for syntax and logic errors, run the test command, and report findings. Critically, the reviewer's prompt must constrain it to small, targeted fixes only (e.g. fixing a broken import or a one-line syntax error) and must explicitly prohibit large refactors or architectural changes. This keeps the reviewer in a QA role rather than turning it into a second implementer.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** pair-programming, review, llm
- **Level:** task
- **Started:** 2026-04-16T16:56:11.179Z
- **Completed:** 2026-04-20T13:10:31.398Z
- **Duration:** 3d 20h 14m
