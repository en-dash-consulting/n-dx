---
id: "d8036b40-fcf9-4d56-a89d-d315041e995b"
type: "change"
title: "Extract smart-add error classifier into shared LLM error utility and extend ERROR_HINTS"
slug: "extract-smart-add-error-classifier"
intent: "Move the classifySmartAddError logic (smart-add.ts:634-720) into a shared module (e.g., rex/src/cli/llm-error-classifier.ts) that any LLM-calling command can import. Generalize the function signature to accept the raw error and return a structured { message, suggestion, category } result. Add LLM-specific patterns to ERROR_HINTS in errors.ts so the top-level CLI error handler can also provide useful messages for unhandled LLM errors: rate-limit (429/retry-after), token exhaustion (budget exceeded), auth failure (401/invalid key), malformed response (JSON parse failure), and timeout."
acceptanceCriteria:
  - "New shared module exports classifyLLMError function that smart-add.ts imports instead of the inline classifier"
  - "classifyLLMError returns structured { message: string, suggestion: string, category: 'rate-limit' | 'auth' | 'budget' | 'parse' | 'network' | 'server' | 'unknown' }"
  - "ERROR_HINTS in errors.ts includes patterns for 429/rate-limit, 401/auth, timeout, and overloaded/529 errors"
  - "smart-add.ts updated to import from shared module with no behavior change (regression test passes)"
  - "Unit tests for classifyLLMError cover all six error categories with representative error strings"
touches:
  - "0d84e500-04a1-4186-a4ea-6cf98d305920"
priority: "critical"
tags:
  - "llm"
  - "rex"
  - "error-handling"
source: "smart-add"
---
