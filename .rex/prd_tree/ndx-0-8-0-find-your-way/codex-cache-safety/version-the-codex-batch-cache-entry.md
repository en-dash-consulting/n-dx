---
id: "0c437e81-6092-45e7-a5dd-358d2c662184"
level: "task"
title: "Version the Codex batch-cache entry and key it by worktree, revision, source fingerprint and policy"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "codex-cache-safety"
  - "pr-19"
source: "caos work management: WM-2147 (Version the Codex batch-cache entry and key it by worktree, revision, source fingerprint and policy); 0.8.0 planning, PR 19 · Codex cache safety"
startedAt: "2026-09-28T18:50:22.807Z"
completedAt: "2026-09-28T19:22:33.969Z"
endedAt: "2026-09-28T19:22:33.969Z"
acceptanceCriteria:
  - "A chain created in one worktree cannot resume in another (test)."
  - "Every rejection reason has a stable machine-readable code and a unit test."
  - "An unversioned (pre-0.8.0) entry is treated as a miss, not an error."
description: "Codex session reuse tracks only vendor, model, task count and last task title, so a resumed chain can belong to another worktree, branch, source state or prompt policy. Version the batch-cache entry and key it by worktree, branch or revision, source fingerprint, policy hash, vendor, model, creation and last-use time and a TTL, so any mismatch produces a named miss. Bias toward a false miss over a wrong hit.\n\nImplementation notes: Extend BatchChainEntry, isBatchChainUsable and the BatchChainRejection codes in packages/hench/src/agent/lifecycle/session-cache.ts (sourcevisionFingerprint already exists there); wire the new inputs from the codex adapter (agent/lifecycle/adapters/codex-cli-adapter.ts). Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-28T19:22:34.802Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
