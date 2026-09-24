---
id: "c943aa11-0897-4a86-b123-0a91be9eb493"
level: "task"
title: "Prove the uncommitted-work refusal in finalizeRun holds the claim"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "claims-hardening"
  - "pr-e"
  - "audit-2026-09-23"
source: "0.7.1 release audit 2026-09-23 (main @ ee165780)"
acceptanceCriteria:
  - "Integration test: a run whose completion the uncommitted-work gate refuses leaves a claims entry with reason uncommitted-work for that task."
  - "The test fails if the hold call in finalizeRun is replaced with a release."
  - "Teardown uses RM_RETRY or cleanupProjectDir."
description: "PR D (#392) tests `TaskClaims.hold` in isolation (`task-claims-selection.test.ts`), but no test drives `finalizeRun`'s refusal path (`packages/hench/src/agent/lifecycle/shared.ts`, near 2883) and checks that the claim is held rather than released. The wiring reads correctly today; nothing stops a refactor from breaking it.\n\nEvidence, 2026-09-23: hench run 01c990df (WM2097, Claude CLI provider, main checkout) ended its session before committing; the uncommitted-work gate refused completion and reset the task to pending, and .git/ndx/claims.json was rewritten to an empty claims map at the moment of refusal — the claim was released, not held. So on this path the hold does not happen; this is a bug to fix, not only a test to add.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T23:40:56.816Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
