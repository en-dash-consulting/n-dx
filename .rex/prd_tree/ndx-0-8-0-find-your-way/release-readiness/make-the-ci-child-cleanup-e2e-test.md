---
id: "2ace2a6c-a745-4c0b-9fdc-98532671b345"
level: "task"
title: "Make the ci child-cleanup e2e test deterministic under full-suite load"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "release-readiness"
  - "test-determinism"
  - "post-pr"
source: "Observed 2026-09-28 during the 0.8.0 lane-A autonomous runs; scheduled post-PR so it lands once every A and B PR is merged and the suite is stable."
acceptanceCriteria:
  - "tests/e2e/cli-ci-child-cleanup.test.js passes in the full `npm run test` suite on three consecutive runs under concurrent build load, not only standalone."
  - "The SIGINT child-record wait is driven by an explicit promise gate or fake timers rather than by a real-time wait on ci-child-pids.jsonl."
  - "The temp-directory teardown no longer fails with EBUSY on Windows when the child process tree is still exiting."
  - "tests/e2e/wall-clock-inventory-policy.test.js (or its successor scanner) detects this test's load-sensitivity automatically, so the next child-process ordering test is flagged rather than found by hand."
  - "The wall-clock assertion inventory lists the test and its resolution."
description: "Run this after every A and B PR for 0.8.0 is merged, so the fix lands against the final suite rather than racing the feature branches.\n\ntests/e2e/cli-ci-child-cleanup.test.js > \"force-kills the ci subprocess after SIGINT interruption\" is a load-induced flake. Standalone it passes in 2.22s (2 tests). Inside the full suite on 2026-09-28 it failed at 9277ms with `Error: Timed out waiting for required CI child records at C:\\...\\ndx-ci-child-cleanup-DK9MBr\\ci-child-pids.jsonl`, immediately followed by `Error: EBUSY: resource busy or locked, rmdir` on the same temp directory — the teardown races a child process tree that has not finished exiting. That run was 1 failed / 2733 passed at the root level, and it was the only root failure; measured full-suite duration on an idle machine is 384s.\n\nWhy this matters beyond CI noise: hench's test gate runs the whole suite for every task (`node scripts/run-all-tests.mjs`), so this single test can fail any autonomous run's gate at random. When the gate fails, hench declines to apply the agent's completion and leaves the work uncommitted, which then blocks every following task in that lane on the dirty-tree guard. Raising hench.fullTestTimeoutMs does not help — the test does not time out, it asserts on records that never arrive under load.\n\nIt is the same failure class as the sibling item \"Real-timer ordering assertions are load-sensitive and invisible to the wall-clock inventory scanner\" (518ece53-aad7-4902-a899-9de45f6635d8), and it is invisible for the same reason: tests/e2e/wall-clock-inventory-policy.test.js requires a duration identifier to flag a site, and this test asserts child-process records and ordering rather than an elapsed duration. Prefer the explicit-gate technique — packages/rex/tests/integration/concurrent-write-lost-update.test.ts is the worked example whose verdict load cannot reorder. Consider whether the scanner extension belongs here or in 518ece53 so the work is not done twice.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-28T17:12:06.592Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
