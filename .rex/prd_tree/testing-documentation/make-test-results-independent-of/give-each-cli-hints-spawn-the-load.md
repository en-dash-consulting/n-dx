---
id: "dc6224ba-995f-4d0b-8f95-638f148d5590"
level: "task"
title: "Give each cli-hints spawn the load-scaled budget, not a fixed 10 seconds"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "test-determinism"
  - "pr-t"
  - "audit-2026-09-23"
source: "0.7.1 release audit 2026-09-23 (main @ ee165780)"
acceptanceCriteria:
  - "Every spawn in packages/sourcevision/tests/e2e/cli-hints.test.ts uses a timeout derived from BUDGET_MULTIPLIER."
  - "The file passes three consecutive preflight runs on a loaded machine, documented in the PR."
  - "tests/unit/vitest-timeout-policy.test.js still passes."
description: "WM2096 (#388) raised the cli-hints test timeout to `15_000 * BUDGET_MULTIPLIER`. But `runResult(timeout = 10_000)` in `packages/sourcevision/tests/e2e/cli-hints.test.ts` still kills each spawned sourcevision process at 10s. Under the preflight load that produced 25.8s, one slow spawn is killed and the test fails on an exit code rather than a timeout. The flake is narrowed, not removed. This is a test-only change, so it needs no changeset.\n\nRecurred 2026-09-24 in hench run 8dc53406's test gate, on a loaded machine (load averages about 10.9 and 9.6): \"typo-correction hints > follow-through: hinted 'analyze' exits 0 on small fixture\" failed. The same suite passed moments later on a quiet machine. The gate's timeout overrun in that run is tracked separately (4b45c028)."
lastModified: "2026-09-24T20:31:15.784Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
