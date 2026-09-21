---
id: "8087847b-48a3-4298-bb06-b4f492289a02"
level: "task"
title: "Expose Google model and API key configuration in ndx config and .n-dx.json schema"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "config"
  - "google"
source: "smart-add"
startedAt: "2026-06-05T12:49:42.602Z"
completedAt: "2026-06-05T13:13:29.979Z"
endedAt: "2026-06-05T13:13:29.979Z"
resolutionType: "code-change"
resolutionDetail: "Added llm.google.model validation (gemini- prefix check), llm.google.apiKeyEnv config field and validator, updated runGoogleApiPreflight to use configured apiKeyEnv, extended help text, and added 27 integration tests."
acceptanceCriteria:
  - "ndx config llm.google.model <model-id> persists the value and is reflected in ndx config output"
  - "ndx config --help lists llm.google.model and llm.google.apiKeyEnv with descriptions"
  - "llm.google.apiKeyEnv defaults to GEMINI_API_KEY and can be overridden via config"
  - "Schema validation rejects an unknown Google model ID with an error naming the field"
  - "Unit tests cover schema validation for valid and invalid Google config entries"
description: "Add llm.google.model and llm.google.apiKeyEnv fields to the .n-dx.json config schema and the ndx config command surface. Allow users to override the active Gemini model ID and specify a custom environment variable name for the API key. Ensure config help text documents all Google-specific keys and schema validation rejects unknown model IDs with an actionable error."
overrideMarker: {"type":"duplicate_guard_override","reason":"semantic_title","reasonRef":"semantic_title:4b559467-5391-4612-ab7d-27b71daac4dc","matchedItemId":"4b559467-5391-4612-ab7d-27b71daac4dc","matchedItemTitle":"Expose timeout configuration in .n-dx.json schema and ndx config command","matchedItemLevel":"task","matchedItemStatus":"completed","createdAt":"2026-06-04T19:16:57.130Z"}
---
