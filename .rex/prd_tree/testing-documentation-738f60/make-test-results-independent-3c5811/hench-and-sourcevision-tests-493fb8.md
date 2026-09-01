---
id: "493fb875-edf4-4be6-9b1c-ccb10dfc236f"
level: "task"
title: "hench and sourcevision tests spawn dist/ with no build guard at all"
status: "completed"
priority: "low"
tags:
  - "e2e-finding"
  - "test-infra"
  - "severity:low"
source: "ndx-capture"
startedAt: "2026-09-01T19:18:35.675Z"
completedAt: "2026-09-01T19:22:21.986Z"
endedAt: "2026-09-01T19:22:21.986Z"
resolutionType: "code-change"
resolutionDetail: "Added requireFreshBuiltCli() guard to all six dist-spawning test files via per-package helpers in hench and sourcevision"
acceptanceCriteria:
  - "Each of the six listed tests fails with a message naming the build when dist/ is missing or older than src/"
  - "The guard is shared or duplicated deliberately, with the choice recorded — three near-identical copies should be a decision rather than an accident"
  - "A stale-dist run of the hench and sourcevision suites is checked by hand once, the way e8d1026d verified rex's"
description: "Audit result from task e8d1026d, whose criterion 3 asked that other dist/-spawning tests be checked for the same existence-only guard. The finding is worse than expected: the merge-driver test was the only one with any guard at all.\n\nSix files spawn `node <package>/dist/cli/index.js` with no existence check and no freshness check:\n\n- packages/hench/tests/e2e/cli-hints.test.ts\n- packages/hench/tests/e2e/cli-init.test.ts\n- packages/hench/tests/integration/cross-vendor-init-smoke.test.ts\n- packages/sourcevision/tests/e2e/cli-analyze.test.ts\n- packages/sourcevision/tests/e2e/cli-hints.test.ts\n- packages/sourcevision/tests/e2e/cli-serve.test.ts\n\nA missing dist gives them ERR_MODULE_NOT_FOUND from a spawned process, surfacing as an exit code and empty stdout against an assertion about hint text. A stale dist is worse — they assert against the previous build's behaviour and fail on the diff, exactly the class of misdirection that cost a validation cycle on the merge-driver test.\n\nThe repo-level `tests/e2e/verify-build.js` globalSetup covers the root `tests/e2e` suite only, and warns rather than throws locally by design, so it does not help these per-package suites.\n\nFix is mechanical: `packages/rex/tests/helpers/built-cli.ts` (added by e8d1026d) is package-local by convention — each package has its own `tests/helpers/`. Either copy it into hench and sourcevision and call `requireFreshBuiltCli()` in each file's setup, or decide the three copies are worth consolidating into a shared dev-only location first. Note the copies would differ only in the `pnpm --filter` package name in the message.\n\nNot urgent: these fail loudly either way, just not informatively, and CI always builds before testing."
lastModified: "2026-09-01T19:22:22.010Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
