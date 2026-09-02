---
id: "6f950a55-accb-4437-a896-80da29fa986a"
level: "task"
title: "Wire Google vendor into sourcevision analyze LLM path"
status: "completed"
priority: "medium"
tags:
  - "google"
  - "sourcevision"
  - "llm-client"
source: "smart-add"
startedAt: "2026-06-05T14:00:50.695Z"
completedAt: "2026-06-05T14:14:39.347Z"
endedAt: "2026-06-05T14:14:39.347Z"
resolutionType: "code-change"
resolutionDetail: "Fixed getAuthMode() to fall through for Google (LLMProvider shape has no top-level .mode). Fixed classifyLLMError to emit Google-specific auth suggestion. Added tests in llm-client and sourcevision."
acceptanceCriteria:
  - "`ndx analyze` and `ndx plan` complete successfully with `llm.vendor=google` set and output a valid CONTEXT.md"
  - "The vendor/model header in analyze output shows the resolved Google model"
  - "LLM error classification (rate limit, budget, bad response) works for Google failures during analyze"
  - "No silent fallback to Claude or Codex occurs when vendor=google and an API key is present"
description: "sourcevision analyze drives several LLM passes (zone enrichment, findings generation, next-steps scoring). These passes call resolveVendorModel but may not handle the google vendor branch, falling back silently. Update the analyze pipeline to route all LLM invocations through the Google adapter when `llm.vendor=google`, and ensure the vendor header is printed in analyze output and any LLM errors surface through the shared classifier."
---
