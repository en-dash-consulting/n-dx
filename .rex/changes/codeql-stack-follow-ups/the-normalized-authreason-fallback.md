---
id: "5e022691-8ad6-46ff-9a1b-9407da311d1a"
type: "task"
title: "The normalized authReason fallback never runs for a plain-text auth error"
slug: "the-normalized-authreason-fallback"
description: "llm-error-classifier.ts ~543-558: extractProviderDetail echoes a body with no JSON back as the detail, so cleanProviderDetail is the raw message and authReason becomes the raw message; the normalized reasons (invalid API key, token expired, not logged in, 401 Unauthorized) are reached only for an empty message or one whose detail still holds a brace. Existing tests only toMatch(/invalid/i). Surfaced by the layer 4 build of stack #855. Fixing changes AuthFailureError.authReason wording for every plain-text auth error, so it needs its own tests and changeset note."
acceptanceCriteria:
  - "A plain-text 'Invalid API key provided' body yields the normalized authReason, with a test that fails on the old code"
  - "JSON bodies keep their extracted error.message as the reason"
priority: "low"
source: "codeql-triage"
---
