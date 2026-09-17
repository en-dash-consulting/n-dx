---
id: "cc8616dd-581e-4fa7-abb4-6276b2e0882c"
level: "task"
title: "Implement vendor-change model reset to prevent cross-vendor stale config"
status: "completed"
priority: "high"
tags:
  - "config"
  - "llm"
  - "validation"
  - "hench"
source: "smart-add"
startedAt: "2026-04-14T16:28:40.254Z"
completedAt: "2026-04-14T16:33:04.257Z"
acceptanceCriteria:
  - "Changing the vendor via ndx config clears or resets the model field if the current model value is not valid for the new vendor"
  - "A warning is emitted when a stale model value is detected and auto-cleared, stating the old value and the new resolved default"
  - "Manually editing .n-dx.json to change vendor without updating model triggers a validation warning on the next ndx work or ndx config run"
  - "No model reset occurs when the vendor is unchanged"
  - "Unit tests cover the vendor-change detection and reset logic for at least two vendor transitions (e.g. claude → codex, codex → claude)"
description: "When the user changes the LLM vendor in .n-dx.json (or via ndx config), any previously persisted model value is likely invalid for the new vendor. Detect vendor/model mismatch at config write time and either clear the model field automatically or prompt the user to confirm or reset it."
---
