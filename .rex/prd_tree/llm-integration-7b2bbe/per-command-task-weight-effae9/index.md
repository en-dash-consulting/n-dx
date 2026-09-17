---
id: "effae917-a7c4-4c7a-a0f8-2b8dce95ca58"
level: "feature"
title: "Per-Command Task Weight Classification and Integration"
status: "completed"
source: "smart-add"
startedAt: "2026-04-15T17:52:00.764Z"
completedAt: "2026-04-15T17:52:00.764Z"
acceptanceCriteria: []
description: "Classify each LLM-calling command by its natural task weight and wire that weight through to the model resolver. Commands doing single-turn proposal generation or lightweight classification use 'light'; commands doing multi-turn agent loops, deep analysis, or ambiguous work use 'standard' (the default). This makes token-cost optimization automatic and transparent."
---

## Children

| Title | Status |
|-------|--------|
| [Add unit and integration tests for weight-aware model resolution across packages](./add-unit-and-integration-tests-00b941.md) | completed |
| [Surface active model tier in vendor header output and log task weight reasoning](./surface-active-model-tier-in-565c00.md) | completed |
| [Wire light-tier model selection into rex smart-add and lightweight analysis paths](./wire-light-tier-model-selection-891e3a.md) | completed |
