---
id: "405c9fcf-2258-472f-8eb7-30d5b7ae0b8a"
level: "feature"
title: "Model Tier Registry and Weight-Aware Resolution"
status: "completed"
source: "smart-add"
startedAt: "2026-04-15T17:25:49.451Z"
completedAt: "2026-04-15T17:25:49.451Z"
acceptanceCriteria: []
description: "Extend the centralized model resolver in llm-client to support task-weight-based model selection. Light tasks (single-turn proposals, simple classification) resolve to cheaper/faster models (haiku, gpt-5.4mini), while standard tasks (multi-turn agents, deep analysis) resolve to full-capability models (sonnet, gpt-5.4codex). Ambiguous or uncategorizable work defaults to standard tier."
---

# Model Tier Registry and Weight-Aware Resolution

 [completed]

## Summary

Extend the centralized model resolver in llm-client to support task-weight-based model selection. Light tasks (single-turn proposals, simple classification) resolve to cheaper/faster models (haiku, gpt-5.4mini), while standard tasks (multi-turn agents, deep analysis) resolve to full-capability models (sonnet, gpt-5.4codex). Ambiguous or uncategorizable work defaults to standard tier.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add per-tier model override fields to LLMConfig schema and config loader | task | completed | 2026-04-15 |
| Define TaskWeight type and per-vendor tier model constants in llm-client | task | completed | 2026-04-15 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-15T17:25:49.451Z
- **Completed:** 2026-04-15T17:25:49.451Z
- **Duration:** < 1m
