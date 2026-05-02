---
id: "0d84e500-04a1-4186-a4ea-6cf98d305920"
level: "feature"
title: "Shared LLM Error Classification with Token Exhaustion, Bad Response, and Rate-Limit Diagnostics"
status: "completed"
source: "smart-add"
startedAt: "2026-04-21T17:39:34.103Z"
completedAt: "2026-04-21T17:39:34.103Z"
acceptanceCriteria: []
description: "Only smart-add.ts has sophisticated LLM error classification (classifySmartAddError, lines 634-720) that detects rate limits (429), auth failures (401), network errors, malformed responses, and server errors. All other LLM-calling commands (reshape, reorganize, prune, sourcevision analyze) either silently swallow errors or throw generic messages. The ERROR_HINTS array in errors.ts has no LLM-specific patterns. Users hitting token exhaustion, rate limits, or bad responses in these commands get unhelpful stack traces instead of actionable guidance."
---

## Children

| Title | Status |
|-------|--------|
| [Add rate-limit cooldown detection with retry-after countdown and timeout state messaging](./add-rate-limit-cooldown-f61ca6/index.md) | completed |
| [Extract smart-add error classifier into shared LLM error utility and extend ERROR_HINTS](./extract-smart-add-error-d8036b/index.md) | completed |
| [Wire shared error classifier and budget preflight into reshape, reorganize, prune, and sourcevision analyze](./wire-shared-error-classifier-0454e5/index.md) | completed |
