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

## Children

| Title | Status |
|-------|--------|
| [Add regression tests for vendor-scoped model selection in rex commands](./add-regression-tests-for-vendor-0270df/index.md) | completed |
| [Audit rex LLM call sites for vendor/model resolver gaps](./audit-rex-llm-call-sites-for-633f58/index.md) | completed |
| [Fix rex commands to use resolved GPT model when vendor is codex](./fix-rex-commands-to-use-f0c313/index.md) | completed |
