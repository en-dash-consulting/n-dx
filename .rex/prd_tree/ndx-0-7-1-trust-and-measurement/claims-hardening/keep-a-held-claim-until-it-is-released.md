---
id: "45f584e4-07f9-432b-922d-12e5a30064a1"
level: "task"
title: "Keep a held claim until it is released, or say in the refusal when the hold lapses"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "claims-hardening"
  - "pr-e"
  - "audit-2026-09-23"
source: "0.7.1 release audit 2026-09-23 (main @ ee165780)"
acceptanceCriteria:
  - "Either a held claim survives past its lease expiry and is freed only by ndx claim release, a re-claim from the holding worktree, or release --force; or the refusal, ndx claim list and the Execute 409 each state when the hold expires."
  - "An integration test with a controlled clock covers the chosen behaviour past the 4h default lease."
  - "The TODO at claims.ts:353 is resolved or removed."
description: "PR D (#392, WM2045) holds a claim with reason `uncommitted-work` when the completion gate refuses, and a held claim outlives its process. It still ends at the lease expiry it had at its last renewal, though: the default lifetime is 4h (`packages/rex/src/store/claims.ts:41`), the hold does not extend it (`claims.ts:347-360`), and a TODO at `claims.ts:353` says so. After that another worktree can pick the task and redo work that is sitting uncommitted. The refusal text says the task is \"held until someone deals with that work\", which promises more than the code does.\n\nPick one. Recommended: a held claim does not expire; it ends only on `ndx claim release`, a re-claim from the holding worktree, or `release --force`. Alternative: keep the expiry and have every message state when the hold lapses.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T18:39:50.260Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
