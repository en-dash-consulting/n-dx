---
id: "405c9fcf-2258-472f-8eb7-30d5b7ae0b8a"
level: "feature"
title: "Model Tier Registry and Weight-Aware Resolution"
status: "pending"
source: "smart-add"
startedAt: "2026-04-15T17:25:49.451Z"
endedAt: "2026-08-31T16:40:21.442Z"
acceptanceCriteria: []
description: "Extend the centralized model resolver in llm-client to support task-weight-based model selection. Light tasks (single-turn proposals, simple classification) resolve to cheaper/faster models (haiku, gpt-5.4mini), while standard tasks (multi-turn agents, deep analysis) resolve to full-capability models (sonnet, gpt-5.4codex). Ambiguous or uncategorizable work defaults to standard tier."
lastModified: "2026-10-02T03:54:46.206Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add per-tier model override fields to LLMConfig schema and config loader](./add-per-tier-model-override-fields-to.md) | completed |
| [Define TaskWeight type and per-vendor tier model constants in llm-client](./define-taskweight-type-and-per-vendor.md) | completed |
| [TIER_MODELS entries can drift out of MODEL_COSTS with no test to catch it](./tier-models-entries-can-drift-out-of.md) | completed |
| [Update Claude model lists and defaults for the Opus 5.5, Sonnet 5.5 and Fable 5.1 releases](./update-claude-model-lists-and-defaults.md) | in_progress |
