---
id: "2e4d0c5e-3a2f-496b-809b-be4a2953979f"
level: "task"
title: "Count hench runs, not turns, in ndx usage"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "cost-measurement"
  - "wm-2052"
blockedBy:
  - "2b86bc48-6cab-4cd1-bc15-b05ee38fc14d"
source: "caos work management: WM2052 (Count hench runs, not turns, in ndx usage); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "A fixture with 10 hench runs of many turns each reports '10 runs' on the hench line and per hench command."
  - "rex and sourcevision lines still report calls."
  - "`ndx usage --format=json` exposes both runs and calls for hench so nothing downstream loses the turn count."
  - "Unit test in packages/rex/tests/unit/core/token-usage.test.ts covers it."
description: "`ndx usage` (packages/rex/src/cli/commands/usage.ts over packages/rex/src/core/token-usage.ts) labels the hench line in 'runs' but the number it prints is the call count, so a batch of 10 runs reports 1,851 runs. It is the first number a reviewer sees. Count distinct run ids for hench while keeping call counts for rex and sourcevision, and make the per-command breakdown consistent.\n\nImplementation notes: In packages/rex/src/core/token-usage.ts, aggregate hench usage by distinct run id and expose both `runs` and `calls` per package and per command; in packages/rex/src/cli/commands/usage.ts print runs for hench and calls for rex and sv, and include both fields in --format=json output. Do this after PR #353 merges because it rewrites the same file. Add a unit test with a fixture of 10 runs containing many turns. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T17:24:20.428Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
