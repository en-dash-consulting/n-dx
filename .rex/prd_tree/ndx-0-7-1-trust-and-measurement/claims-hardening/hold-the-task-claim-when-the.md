---
id: "8257feec-266e-412a-9881-c0b93dc5d53c"
level: "task"
title: "Hold the task claim when the uncommitted-work gate refuses completion"
status: "in_progress"
priority: "high"
tags:
  - "0.7.1"
  - "claims-hardening"
  - "wm-2045"
source: "caos work management: WM2045 (Hold the task claim when the uncommitted-work gate refuses completion); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "Integration test: a run whose completion is refused by the uncommitted-work gate ends with the claim still present in the store, carrying a reason of uncommitted work and the worktree path."
  - "A second worktree's `ndx work` skips that task and, if the task is requested explicitly, exits non-zero naming the holding worktree and the reason."
  - "Normal completion, failure, cancellation by SIGINT and dry runs release or never take the claim exactly as before (existing tests pass)."
  - "The held claim expires at its existing TTL if nothing acts on it, and `ndx claim --release` (companion item) frees it early."
description: "packages/hench/src/cli/commands/run.ts takes a cross-worktree claim for the selected task (TaskClaims in packages/hench/src/process/task-claims.ts, store in packages/rex/src/store/claims.ts, four-hour TTL renewed by a timer) and releases it in a finally block. When the uncommitted-work gate (packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts) refuses to mark the task complete because work is still uncommitted in this worktree, the claim is released anyway, so a second worktree can claim the task and redo work that already exists. On that path the claim must be kept: stop renewing, record why it is held, and let selection in other worktrees skip it and say who holds it and why.\n\nImplementation notes: In packages/hench/src/cli/commands/run.ts and packages/hench/src/process/task-claims.ts, distinguish the run outcome 'completion refused: uncommitted work' (produced by findUncommittedWork / formatUncommittedWorkRefusal in agent/lifecycle/uncommitted-work-gate.ts) from other exits. On that outcome do not call releaseAll for the task; instead stop the renewal timer and update the claim record with a held reason ('uncommitted-work') and the worktree root. Extend the TaskClaim type in packages/rex/src/store/claims.ts with an optional reason field (additive), and make rex's selection explanation (core/next-task.ts SelectionExplanation reason codes) and hench's TaskClaimedElsewhereError include the reason and worktree in their messages. Add the integration test to packages/hench/tests/integration/task-claims-selection.test.ts using the store's injectable clock. Route all rex access through packages/hench/src/prd/rex-gateway.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T20:15:39.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
