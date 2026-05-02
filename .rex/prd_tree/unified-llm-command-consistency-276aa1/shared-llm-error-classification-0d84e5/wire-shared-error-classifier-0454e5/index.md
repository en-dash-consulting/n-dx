---
id: "0454e5d5-4f7e-42e8-becd-05c05fdfd2e2"
level: "task"
title: "Wire shared error classifier and budget preflight into reshape, reorganize, prune, and sourcevision analyze"
status: "completed"
priority: "critical"
tags:
  - "llm"
  - "rex"
  - "sourcevision"
  - "error-handling"
source: "smart-add"
startedAt: "2026-04-21T16:49:30.563Z"
completedAt: "2026-04-21T17:07:20.491Z"
resolutionType: "code-change"
resolutionDetail: "Moved classifyLLMError to @n-dx/llm-client foundation tier. Wired budget preflight + classified error handling into reshape, reorganize, prune, and sourcevision analyze. 51 new tests across 3 packages."
acceptanceCriteria:
  - "reshape, reorganize, prune, and sourcevision analyze call preflightBudgetCheck (or equivalent) before LLM calls when budget config is present"
  - "All four commands catch LLM errors and pass them through classifyLLMError before displaying to user"
  - "Rate-limit errors display the retry-after duration if available and suggest waiting"
  - "Token exhaustion errors display remaining budget and suggest increasing via ndx config"
  - "Malformed response errors display truncated response preview and suggest retrying or reducing PRD size"
  - "reorganize no longer silently returns empty proposals on LLM failure — error is surfaced to user"
  - "Integration tests verify each command produces actionable error output for simulated rate-limit, budget-exceeded, and parse-failure scenarios"
description: "The reshape (reshape.ts), reorganize (reorganize.ts:49-56), and prune (prune.ts:182-186,427-430) commands have generic try-catch blocks that swallow LLM errors silently or print opaque messages. None perform preflightBudgetCheck before LLM calls (only rex analyze does). SourceVision analyze has minimal phase-level error handling with no LLM-specific classification. Each command should: (1) call preflightBudgetCheck before the first LLM call, (2) wrap LLM calls in try-catch that uses the shared classifyLLMError utility, and (3) print user-facing error messages with actionable suggestions instead of swallowing or rethrowing generic errors."
---

# Wire shared error classifier and budget preflight into reshape, reorganize, prune, and sourcevision analyze

🔴 [completed]

## Summary

The reshape (reshape.ts), reorganize (reorganize.ts:49-56), and prune (prune.ts:182-186,427-430) commands have generic try-catch blocks that swallow LLM errors silently or print opaque messages. None perform preflightBudgetCheck before LLM calls (only rex analyze does). SourceVision analyze has minimal phase-level error handling with no LLM-specific classification. Each command should: (1) call preflightBudgetCheck before the first LLM call, (2) wrap LLM calls in try-catch that uses the shared classifyLLMError utility, and (3) print user-facing error messages with actionable suggestions instead of swallowing or rethrowing generic errors.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** llm, rex, sourcevision, error-handling
- **Level:** task
- **Started:** 2026-04-21T16:49:30.563Z
- **Completed:** 2026-04-21T17:07:20.491Z
- **Duration:** 17m
