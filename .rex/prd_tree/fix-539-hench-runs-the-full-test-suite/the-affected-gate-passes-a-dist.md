---
id: "e03605a0-a8d9-4d81-8c3d-34672392d507"
level: "task"
title: "the affected gate passes a dist-reading drift test on a stale build, so a source-only change it selects still goes green"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A gate run (`run-all-tests.mjs affected <base>`) where a selected package's src is newer than its dist fails with a message naming the package and the build command, instead of running dist-reading root tests against the old build"
  - "A unit or integration test covers the stale-dist case in the affected path and fails against today's warning-only behaviour"
  - "TESTING.md states how the gate treats a stale dist"
description: "Source: adversarial review of task f76c699d (root-drift membership). Verdict: out-of-scope. The problem existed before that change; the change made it reachable on more paths.\n\nFailure: several root-drift members read the changed package through `dist/`, not `src/`: catalog-runtime-contract (llm-client dist), layout-resolver-contract, effective-agent-config-contract, prd-delta-cli-agreement, cross-package-contracts, web-server-viewer-boundary, hench-config-gate-contract. hench's gate (`.n-dx.json` hench.testGate.command = run-all-tests.mjs affected {base}) builds nothing, and tests/e2e/verify-build.js treats a stale dist (src newer than dist) as a hard error only when CI is set. Locally it prints a warning and the tests go on.\nTrigger: an agent changes DEFAULT_CLAUDE_MODEL in packages/llm-client/src/config.ts and does not run `pnpm --filter @n-dx/llm-client build`. The gate selects root-drift, catalog-runtime-contract reads the old constant from dist and passes, and hench commits. CI builds first and fails. Nothing enforces the build except the epic's written convention (\"Build only the packages you changed\").\nReachable: any `ndx work` run on this repo that edits a package source without rebuilding. tests/unit/select-suites.test.js pins \"the selection runs the test\", and that holds. What it cannot pin is that the test can see the change.\n\nOptions:\n1. (recommended) In the gate path, treat stale dist as fatal. For example run-all-tests.mjs could set an env var that verify-build.js honours like CI, or the affected mode could fail before running any root suite when a selected package's src is newer than its dist. Cost: small. Risk: a gate fails on an edit the agent forgot to build, which is the point.\n2. Have the affected mode build the selected packages before running suites. Cost: build time per gate. This overlaps #539 item 7 (incremental builds).\n3. Repoint the dist-reading drift tests at src where the module is framework-free (as run-options-contract and prd-slug-conformance already do). Cost: per-test work, and not possible for tests that spawn the built CLI."
lastModified: "2026-10-07T17:07:35.744Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
