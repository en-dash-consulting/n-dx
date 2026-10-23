---
id: "633f588d-040d-4187-94a0-84e5e1892e30"
type: "task"
title: "Audit rex LLM call sites for vendor/model resolver gaps"
slug: "audit-rex-llm-call-sites-for-vendor"
description: "Trace every rex command that invokes an LLM (analyze, recommend, add, reorganize, prune) and verify each one routes through the centralized vendor/model resolver introduced in the prior feature. Identify any call sites that hardcode a model string, skip resolver invocation, or fail to forward the resolved vendor to the API client. Produce a list of specific files and lines requiring fixes."
acceptanceCriteria:
  - "All rex LLM call sites are enumerated with their current model-resolution path documented"
  - "Any call site that does not use the centralized resolver is flagged with the specific bypass mechanism"
  - "Audit findings match the behavior observed when running `ndx config llm.vendor codex` followed by a rex analyze command"
priority: "critical"
tags:
  - "rex"
  - "llm"
  - "model-resolution"
source: "smart-add"
---
