---
id: "f0c313d6-0218-4020-98c8-68034346c23a"
level: "task"
title: "Fix rex commands to use resolved GPT model when vendor is codex"
status: "completed"
priority: "critical"
tags:
  - "rex"
  - "llm"
  - "model-resolution"
  - "codex"
source: "smart-add"
startedAt: "2026-04-08T15:36:38.309Z"
completedAt: "2026-04-08T15:46:53.379Z"
acceptanceCriteria:
  - "Running `ndx config llm.vendor codex && rex analyze .` sends requests to a GPT model, not a Claude model"
  - "Running `ndx config llm.vendor claude && rex analyze .` sends requests to a Claude model"
  - "No rex command hardcodes a model string outside of the centralized resolver"
  - "ndx console output surfaces the active vendor and model for rex commands (consistent with prior surface-vendor-model feature)"
  - "Existing rex unit and integration tests pass after the fix"
description: "Based on the audit, update all rex LLM call sites so they invoke the centralized vendor/model resolver and forward the resulting model identifier to the llm-client API call. When the configured vendor is `codex`, the resolver must return a GPT-family model (e.g. `gpt-4o`) rather than a Claude model. This fix must go through `hench/src/prd/llm-gateway.ts` if rex is called from hench, or through rex's own config-reading path for direct rex CLI invocations."
---
