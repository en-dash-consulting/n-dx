---
id: "d35a54ea-69ac-4bd7-87f0-0c073b431d2c"
level: "task"
title: "Dispose the dashboard's per-worktree run watchers when a worktree is removed"
status: "pending"
priority: "low"
tags:
  - "0.7.1"
  - "claims-hardening"
  - "pr-e"
  - "audit-2026-09-23"
source: "0.7.1 release audit 2026-09-23 (main @ ee165780)"
acceptanceCriteria:
  - "When a worktree disappears from git worktree list, its watcher is closed on the next /api/worktrees refresh."
  - "Server shutdown closes every watcher."
  - "A unit test with a fake watcher factory checks open and close counts across add, remove and shutdown."
description: "PR F (#393) made `/api/worktrees` watch the `.hench/runs/` folder of every worktree the dashboard is not serving, so a claim takeover clears its answer cache. Nothing closes a watcher when a worktree is removed or the worktree list changes, so a long-running dashboard accumulates them.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T18:40:19.375Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
