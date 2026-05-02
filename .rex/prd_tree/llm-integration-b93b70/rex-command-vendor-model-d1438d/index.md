---
id: "d1438d1e-9233-4fff-a6d9-6a218d5d50bc"
level: "feature"
title: "Rex Command Vendor-Model Binding Regression Fix"
status: "completed"
source: "smart-add"
startedAt: "2026-04-08T15:52:18.334Z"
completedAt: "2026-04-08T15:52:18.334Z"
acceptanceCriteria: []
description: "When `ndx config llm.vendor codex` is set, rex CLI commands (analyze, recommend, add, etc.) should resolve and use GPT-family models rather than falling back to Claude defaults. The centralized resolver exists but rex call sites may not be reading vendor config correctly or may be bypassing the resolver."
---

# Rex Command Vendor-Model Binding Regression Fix

 [completed]

## Summary

When `ndx config llm.vendor codex` is set, rex CLI commands (analyze, recommend, add, etc.) should resolve and use GPT-family models rather than falling back to Claude defaults. The centralized resolver exists but rex call sites may not be reading vendor config correctly or may be bypassing the resolver.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add regression tests for vendor-scoped model selection in rex commands | task | completed | 2026-04-08 |
| Audit rex LLM call sites for vendor/model resolver gaps | task | completed | 2026-04-08 |
| Fix rex commands to use resolved GPT model when vendor is codex | task | completed | 2026-04-08 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-08T15:52:18.334Z
- **Completed:** 2026-04-08T15:52:18.334Z
- **Duration:** < 1m
