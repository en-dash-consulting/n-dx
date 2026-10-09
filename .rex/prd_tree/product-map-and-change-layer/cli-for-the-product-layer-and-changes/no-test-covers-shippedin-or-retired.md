---
id: "dcf21a42-74f9-4bcb-898d-e937352522f3"
level: "task"
title: "No test covers shippedIn or retired-node releases in collectReleases, so dropping either goes unnoticed"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "pr-18"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A unit test fails when collectReleases stops reading shippedIn"
  - "A unit test fails when collectReleases stops including retired (tombstoned) nodes"
  - "A unit test asserts collectReleases deduplicates and includes packageVersion first"
description: "Verdict: should-fix (low). Found by adversarial review of 36e9ac1d.\n\nScenario: delete the `shippedIn` line from collectReleases (packages/rex/src/core/health.ts), or drop `includeTombstones: true` from its indexTree call. Every test still passes. A change titled \"0.7.0 cleanup\" whose release is recorded only as shippedIn \"0.7.0\" (or only on a retired node) would then go unflagged by `rex health`. The health-v2 tests (packages/rex/tests/unit/cli/commands/health-v2.test.ts) exercise only plannedRelease and the package.json version.\n\nReachable via `rex health` on any v2 tree with shipped changes.\n\nFix: add unit tests for collectReleases in tests/unit/core/health.test.ts covering shippedIn, a tombstoned node's plannedRelease, dedup, and packageVersion. Cost: a few lines; no risk."
lastModified: "2026-10-09T08:33:41.682Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
