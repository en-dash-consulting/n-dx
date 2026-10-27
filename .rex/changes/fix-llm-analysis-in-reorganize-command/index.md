---
id: "4c930737-e43a-47ee-9ba9-b417fe9d6146"
type: "change"
title: "Fix LLM analysis in reorganize command returning invalid responses"
slug: "fix-llm-analysis-in-reorganize-command"
intent: "The LLM analysis pass in `rex reorganize --mode=full` fails consistently. Two observed failure modes: (1) LLM returns prose instead of JSON (hallucinating a file edit approval prompt), (2) LLM returns JSON that fails schema validation with \"Required; Required; Required...\" (missing required fields in reshape proposal objects). The reshape-reason module needs the same JSON extraction/repair pipeline used in rex analyze."
acceptanceCriteria:
  - "LLM analysis in reorganize returns valid JSON proposals or a clean error with details"
  - "Non-JSON LLM responses are handled with extraction/repair before failing"
  - "Schema validation errors include which fields are missing"
touches:
  - "3bf3754c-c0d0-4fb7-9cbd-5ebbddb85d51"
priority: "medium"
tags:
  - "rex"
  - "bugfix"
  - "llm"
---
