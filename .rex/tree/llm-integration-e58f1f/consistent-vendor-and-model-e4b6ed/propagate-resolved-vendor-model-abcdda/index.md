---
id: "abcddab7-0602-4fb4-9f69-5a4101b41a73"
level: "task"
title: "Propagate resolved vendor/model uniformly to all LLM call sites"
status: "completed"
priority: "high"
tags:
  - "llm"
  - "consistency"
  - "refactor"
source: "smart-add"
startedAt: "2026-04-08T13:55:08.183Z"
completedAt: "2026-04-08T14:03:17.530Z"
acceptanceCriteria:
  - "No LLM call site outside the resolver contains a hard-coded model string or independent fallback logic"
  - "Running ndx analyze, ndx plan, ndx work, and ndx recommend with a non-default model config all use the overridden model — verified by log or output inspection"
  - "Integration test confirms that changing the model in config before running two different commands yields the same model in both commands' token usage records"
  - "Grep for hard-coded model strings in packages/rex, packages/hench, packages/sourcevision returns zero production-code hits after this task"
description: "Audit every location in rex, hench, and sourcevision where an LLM call is constructed and ensure each one uses the centralized resolver rather than a local default or inline constant. This includes calls made during analyze, plan, work, recommend, and any background reasoning passes. The goal is that changing the configured model in .n-dx.json produces identical behavior change across every command without per-package patches."
---

# Propagate resolved vendor/model uniformly to all LLM call sites

🟠 [completed]

## Summary

Audit every location in rex, hench, and sourcevision where an LLM call is constructed and ensure each one uses the centralized resolver rather than a local default or inline constant. This includes calls made during analyze, plan, work, recommend, and any background reasoning passes. The goal is that changing the configured model in .n-dx.json produces identical behavior change across every command without per-package patches.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** llm, consistency, refactor
- **Level:** task
- **Started:** 2026-04-08T13:55:08.183Z
- **Completed:** 2026-04-08T14:03:17.530Z
- **Duration:** 8m
