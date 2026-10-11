---
id: "2dce1ca0-926c-45c8-b124-0505a7a20d39"
level: "task"
title: "Stop the tier table from declaring unregistered task classes that fail the task-class registry contract"
status: "pending"
priority: "high"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-4"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack) — follow-up to run 63915f54 / 8986a809, whose gate failed on task-class-registry.test.js"
acceptanceCriteria:
  - "`tests/integration/task-class-registry.test.js` passes; `packages/web/src` declares no `taskClass:` or `resolveTaskModel(` literal that is missing from `DEFAULT_ROUTES`."
  - "Each tier row's model is what `resolveTaskModel(\"agent.execute\", …)` resolves with only that class's route forced to the tier; a project with `llm.tiers.<vendor>.heavy` set reports that model for Heavy."
  - "The Prepare-task \"used by\" entry carries its label and no task class."
  - "`routes-llm-tiers.test.ts` passes with the updated entry shape, along with the label-coverage test."
  - "`pnpm --filter @n-dx/web test`, the package typecheck, and the root affected test gate pass."
description: "Run 63915f54 (task 8986a809) committed the tier table as 084838846, but its test gate failed on `tests/integration/task-class-registry.test.js`. That contract scans every package's source for `taskClass: \"x\"` and `resolveTaskModel(\"x\"` literals and requires each `x` to exist in llm-client's `DEFAULT_ROUTES`.\n\n`packages/web/src/server/llm-tiers.ts` declares two that are not real task classes:\n- `taskClass: \"prepare-task\"` (line ~68): the stand-in entry for the \"tasks set to Heavy in Prepare task\" label.\n- `resolveTaskModel(\"tier.probe\", { ...config, routes: { \"*\": tier } }, { vendor })` (line ~89): an invented class used to ask which model a tier resolves to.\n\nFix both without weakening the contract:\n- Resolve a tier's model the way hench's `modelForTier` does (`packages/hench/src/cli/commands/run-settings.ts`): call `resolveTaskModel(\"agent.execute\", { ...config, routes: { ...config.routes, \"agent.execute\": tier } }, { vendor })`. That forces one registered class's route to the tier and leaves the project's other routes alone, so `llm.tiers` overrides and vendor normalisation apply exactly as in a run.\n- Give the Prepare-task \"used by\" entry no `taskClass`. Make `taskClass` optional on the `usedBy` entry type, or use a distinct field such as `kind: \"prepare-task\"`, so the entry carries only its label.\n\nUpdate `routes-llm-tiers.test.ts` for the changed entry shape. Keep everything else 084838846 delivers: rows, sources, used-by grouping, and the label-coverage test."
lastModified: "2026-10-11T01:59:57.379Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
