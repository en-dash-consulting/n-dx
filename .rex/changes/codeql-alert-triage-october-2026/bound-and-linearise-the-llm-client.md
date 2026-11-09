---
id: "f35328ee-9eed-4f9b-a6db-1ca57be41689"
type: "task"
title: "Bound and linearise the llm-client error classifier and LM Studio error patterns"
slug: "bound-and-linearise-the-llm-client"
description: "Layer 4 of the CodeQL stack (docs/process/codeql-triage-2026-10.md, Layer 4). CodeQL alerts 8 to 17 (js/polynomial-redos) in packages/llm-client/src/llm-error-classifier.ts and local-api-provider.ts. The classified text is the entire provider response body interpolated into Error.message with no truncation, or the vendor CLI's stderr accumulated unbounded. Three patterns are cubic: model.*not.*available (99.6 s on a 50 KB body) and invalid.*api.*key at lines 176, 478 and 503 (59 s). The rest are quadratic at under a quarter second. Fix: a CLASSIFY_WINDOW slice of 4096 characters at the top of isAuthError and parseAuthPayload (keeping the JSON-detail extractors on the full string) and on msg in parseLmStudioError before the test; rewrite each .* gap as a bounded non-newline run and hoist the invalid-api-key pattern to one constant; the ndx-debug sentinel regex at line 217 becomes a single optional space, with no window since the sentinel ends the message. Alerts 6 and 7 in help-format.ts are dismissed: static help literals. Branch fix/llm-client-error-classifier-linear."
acceptanceCriteria:
  - "Every existing isAuthError and parseAuthPayload positive still matches, including invalid x-api-key, Invalid API key provided, invalid_api_key, authentication_error and Authentication failed"
  - "Pathological inputs (invalid api repeated 2000 times, authentication repeated 2000 times, key repeated 10000 times, 20000 spaces before an ndx-debug sentinel) classify within 100 ms with the same result as today"
  - "parseLmStudioError has a unit test covering the model-not-loaded positives, context-overflow extraction and a 20 KB adversarial body"
  - "Patch changeset for @n-dx/llm-client"
priority: "high"
source: "codeql-triage"
---
