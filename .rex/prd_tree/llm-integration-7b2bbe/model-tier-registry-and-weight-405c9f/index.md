---
id: "405c9fcf-2258-472f-8eb7-30d5b7ae0b8a"
level: "feature"
title: "Model Tier Registry and Weight-Aware Resolution"
status: "pending"
source: "smart-add"
startedAt: "2026-04-15T17:25:49.451Z"
acceptanceCriteria: []
description: "Extend the centralized model resolver in llm-client to support task-weight-based model selection. Light tasks (single-turn proposals, simple classification) resolve to cheaper/faster models (haiku, gpt-5.4mini), while standard tasks (multi-turn agents, deep analysis) resolve to full-capability models (sonnet, gpt-5.4codex). Ambiguous or uncategorizable work defaults to standard tier."
lastModified: "2026-08-27T16:49:14.908Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add an invariant test requiring every tier pointer to have cost and context-window entries](./add-an-invariant-test-requiring-8bb23d.md) | completed |
| [Add per-tier model override fields to LLMConfig schema and config loader](./add-per-tier-model-override-2e1d7e.md) | completed |
| [Define TaskWeight type and per-vendor tier model constants in llm-client](./define-taskweight-type-and-per-084b25.md) | completed |
| [Make MODEL_ALIASES.opus track the heavy tier instead of diverging from it](./make-model-aliases-opus-track-34021b.md) | pending |
| [outputPerMToken is multiplied nowhere, so all output-side MODEL_COSTS figures are inert](./outputpermtoken-is-multiplied-359b5e.md) | completed |
| [Verify the corrected MODEL_COSTS prices against Anthropic's published pricing](./verify-the-corrected-model-9c7789.md) | completed |
