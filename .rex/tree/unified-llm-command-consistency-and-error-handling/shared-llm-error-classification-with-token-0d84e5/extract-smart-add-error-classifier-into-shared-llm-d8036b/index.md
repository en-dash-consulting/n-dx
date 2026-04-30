---
id: "d8036b40-fcf9-4d56-a89d-d315041e995b"
level: "task"
title: "Extract smart-add error classifier into shared LLM error utility and extend ERROR_HINTS"
status: "completed"
priority: "critical"
tags:
  - "llm"
  - "rex"
  - "error-handling"
source: "smart-add"
startedAt: "2026-04-21T16:39:13.741Z"
completedAt: "2026-04-21T16:48:16.941Z"
resolutionType: "code-change"
resolutionDetail: "Extracted classifySmartAddError into shared classifyLLMError in rex/src/cli/llm-error-classifier.ts. Added 5 new CLI_ERROR_CODES (AUTH_FAILED, LLM_RATE_LIMITED, LLM_SERVER_ERROR, NETWORK_ERROR, TIMEOUT). Extended ERROR_HINTS with 4 LLM patterns. 28 unit tests for the new classifier."
acceptanceCriteria:
  - "New shared module exports classifyLLMError function that smart-add.ts imports instead of the inline classifier"
  - "classifyLLMError returns structured { message: string, suggestion: string, category: 'rate-limit' | 'auth' | 'budget' | 'parse' | 'network' | 'server' | 'unknown' }"
  - "ERROR_HINTS in errors.ts includes patterns for 429/rate-limit, 401/auth, timeout, and overloaded/529 errors"
  - "smart-add.ts updated to import from shared module with no behavior change (regression test passes)"
  - "Unit tests for classifyLLMError cover all six error categories with representative error strings"
description: "Move the classifySmartAddError logic (smart-add.ts:634-720) into a shared module (e.g., rex/src/cli/llm-error-classifier.ts) that any LLM-calling command can import. Generalize the function signature to accept the raw error and return a structured { message, suggestion, category } result. Add LLM-specific patterns to ERROR_HINTS in errors.ts so the top-level CLI error handler can also provide useful messages for unhandled LLM errors: rate-limit (429/retry-after), token exhaustion (budget exceeded), auth failure (401/invalid key), malformed response (JSON parse failure), and timeout."
---

# Extract smart-add error classifier into shared LLM error utility and extend ERROR_HINTS

🔴 [completed]

## Summary

Move the classifySmartAddError logic (smart-add.ts:634-720) into a shared module (e.g., rex/src/cli/llm-error-classifier.ts) that any LLM-calling command can import. Generalize the function signature to accept the raw error and return a structured { message, suggestion, category } result. Add LLM-specific patterns to ERROR_HINTS in errors.ts so the top-level CLI error handler can also provide useful messages for unhandled LLM errors: rate-limit (429/retry-after), token exhaustion (budget exceeded), auth failure (401/invalid key), malformed response (JSON parse failure), and timeout.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** llm, rex, error-handling
- **Level:** task
- **Started:** 2026-04-21T16:39:13.741Z
- **Completed:** 2026-04-21T16:48:16.941Z
- **Duration:** 9m
