---
id: "1a8ba3b8-82eb-4d90-9079-59810cedae7c"
level: "task"
title: "Wire Google vendor into hench run loop, rex commands, and llm-gateway"
status: "deferred"
priority: "critical"
tags:
  - "hench"
  - "rex"
  - "google"
  - "integration"
source: "smart-add"
startedAt: "2026-06-04T19:45:36.240Z"
acceptanceCriteria:
  - "ndx work with llm.vendor=google successfully dispatches agent turns to the Gemini API and produces a completed hench run record"
  - "Vendor header printed at run start shows 'google / <resolved-model-id>'"
  - "rex smart-add and analyze commands use the Google adapter when vendor=google"
  - "Weight-aware model resolution selects the correct Gemini tier model for light, standard, and heavy task weights"
  - "Regression tests for vendor-scoped model selection cover the google vendor branch"
  - "Existing Claude and Codex dispatch paths have no regressions"
description: "Update hench/src/prd/llm-gateway.ts and rex LLM call sites to dispatch to the Google adapter when llm.vendor is set to 'google'. Ensure resolveVendorModel, vendor header display at run start, and task-weight-aware model selection all handle the google vendor branch. Add google to the rex vendor-model binding regression tests and verify no regressions in Claude or Codex dispatch."
---
