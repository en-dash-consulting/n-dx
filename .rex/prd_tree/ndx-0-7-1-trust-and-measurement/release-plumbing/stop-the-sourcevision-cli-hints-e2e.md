---
id: "f60a4405-125c-4a86-84ed-8f93ffa26d12"
level: "task"
title: "Stop the sourcevision cli-hints e2e test timing out under preflight load"
status: "completed"
priority: "high"
tags:
  - "0.7.1"
  - "release-plumbing"
  - "wm-2096"
  - "pr-none"
source: "caos work management: WM2096 (Stop the sourcevision cli-hints e2e test timing out under preflight load); follow-up from the guards run 2026-09-22, PR group none"
startedAt: "2026-09-22T15:15:13.889Z"
completedAt: "2026-09-22T15:15:13.889Z"
endedAt: "2026-09-22T15:15:13.889Z"
acceptanceCriteria:
  - "pnpm preflight passes three times in a row under concurrent build load with this test included."
  - "The fix uses the documented escape hatch (budget multiplier or serial e2e grouping) and is registered where TESTING.md says such cases are tracked."
  - "The test still passes in isolation in about the same time as today."
description: "packages/sourcevision/tests/e2e/cli-hints.test.ts has one case that took 25.8 seconds against a 15 second testTimeout during pnpm preflight, turning the pre-push gate red, while passing in 2.4 seconds in isolation. It is TESTING.md flake family 3 (spawn-heavy e2e under concurrent load), pre-existing and unrelated to the guards branch, but it makes the pre-push gate unreliable for every 0.7.1 pull request. Make the case reliable now with the documented mechanisms (the budget multiplier or a serial group for spawn-heavy e2e), not by scaling a wall-clock assertion; the general determinism work is 0.8.0.\n\nImplementation notes: Reproduce by running pnpm preflight while another pnpm build runs. In packages/sourcevision/tests/e2e/cli-hints.test.ts either apply the documented BUDGET_MULTIPLIER to its testTimeout or move the spawn-heavy case into the serial e2e group, following the guidance in TESTING.md for flake family 3, and register the case where that document says to. Do not raise a bare constant. No changeset (tests only). Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T15:15:14.223Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
