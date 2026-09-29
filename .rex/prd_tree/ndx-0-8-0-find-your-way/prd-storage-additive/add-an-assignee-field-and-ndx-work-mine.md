---
id: "cd3a52ad-3ae1-42e1-b1c0-f52433b6c58a"
level: "task"
title: "Add an assignee field and ndx work --mine"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "prd-storage-additive"
  - "pr-18"
blockedBy:
  - "d417fda4-0b26-4c16-8482-842788bdbc5f"
source: "caos work management: WM-2131 (Add an assignee field and ndx work --mine); 0.8.0 planning, PR 18 · PRD storage additive"
startedAt: "2026-09-29T16:10:47.541Z"
completedAt: "2026-09-29T16:56:23.661Z"
endedAt: "2026-09-29T16:56:23.661Z"
resolutionType: "code-change"
resolutionDetail: "Added PRDItem.assignee (schema/v1.ts), a PrioritizationOptions.assignee exact-match filter in core/next-task.ts, resolveActor re-exported through hench's rex-gateway.ts, and hench run --mine (threaded through runOne/runIterations/runLoop/peekNextTaskPriority and assembleTaskBrief) resolving the current user via resolveActor. Not supported with --epic-by-epic, matching --tags' existing scope."
acceptanceCriteria:
  - "ndx work --mine picks only items assigned to the current user."
  - "A tree with no assignee fields selects tasks exactly as today (test)."
  - "Assignee round-trips through the folder tree and is omitted when unset."
description: "An assignee field with ndx work --mine lets a person work only their own items.\n\nImplementation notes: Add the optional field in packages/rex/src/schema/v1.ts, filter in core/next-task.ts, resolve the current user from core/identity.ts, and add --mine to hench's run command (packages/hench/src/cli/commands/run.ts) via the rex gateway. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T16:56:24.024Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
