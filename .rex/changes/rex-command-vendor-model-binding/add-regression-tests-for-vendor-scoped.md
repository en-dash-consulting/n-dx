---
id: "0270df79-5844-45ea-8bd9-da2df2ae8a26"
type: "task"
title: "Add regression tests for vendor-scoped model selection in rex commands"
slug: "add-regression-tests-for-vendor-scoped"
description: "Add integration tests that exercise at least one rex LLM command (e.g. rex analyze) with each supported vendor config value and assert that the outbound API call uses a model string consistent with that vendor. Tests should mock the llm-client API boundary so they run without real API credentials."
acceptanceCriteria:
  - "A test with vendor=codex asserts the resolved model is a GPT-family identifier"
  - "A test with vendor=claude asserts the resolved model is a Claude-family identifier"
  - "Tests run as part of `pnpm test` without network access"
  - "Tests fail if a call site bypasses the resolver and uses a hardcoded model"
priority: "high"
tags:
  - "rex"
  - "llm"
  - "testing"
  - "model-resolution"
source: "smart-add"
---
