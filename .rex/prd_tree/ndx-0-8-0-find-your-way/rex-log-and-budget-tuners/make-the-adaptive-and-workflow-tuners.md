---
id: "114c4bc8-5a7f-4940-b45f-84ae38620c32"
level: "task"
title: "Make the adaptive and workflow tuners measure run cost in the same token classes as checkTokenBudget"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "rex-log-budget-tuners"
  - "pr-17"
source: "caos work management: WM-2137 (Make the adaptive and workflow tuners measure run cost in the same token classes as checkTokenBudget); 0.8.0 planning, PR 17 · rex log and budget tuners"
startedAt: "2026-09-28T20:22:46.695Z"
completedAt: "2026-09-28T20:38:04.563Z"
endedAt: "2026-09-28T20:38:04.563Z"
resolutionType: "code-change"
resolutionDetail: "Extracted the counting checkTokenBudget enforces into packages/hench/src/agent/token-cost.ts (countBudgetedTokens / runBudgetedTokens / contextWriteFloor) and routed token-budget.ts plus both tuners through it. Every tokenBudget proposal in adaptive.ts and workflow.ts is now clamped to the measured arrival cost; the workflow tuner's high-consumption threshold was rescaled 100K to 1.2M for the new units. New test tests/unit/agent/token-cost.test.ts drives six real prompt-cached run profiles from .hench/runs/. pnpm preflight green (6/6 suites)."
acceptanceCriteria:
  - "Both tuners measure run cost through one helper shared with checkTokenBudget."
  - "Neither tuner proposes a tokenBudget below the measured context-write floor."
  - "A test feeds recorded prompt-cached run profiles and asserts the tuners' proposals are in the budget's units."
description: "totalTokens() in packages/hench/src/agent/analysis/adaptive.ts and workflow.ts counts input plus output, roughly 11x lower than the budget's count on a prompt-cached run. Against the 600K template budgets the adaptive tuner would propose a tokenBudget near 125K, below the roughly 190K initial context write, so every later run would fail on arrival. Nothing shipped calls the tuners yet, so the exposure today is to library consumers.\n\nImplementation notes: Extract the counting used by checkTokenBudget (packages/hench/src/agent/lifecycle/token-budget.ts) into one helper and call it from agent/analysis/adaptive.ts and agent/analysis/workflow.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-28T20:38:04.932Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
