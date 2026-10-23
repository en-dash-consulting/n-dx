---
id: "e72caddd-238f-426f-b191-4adec1de560d"
type: "change"
title: "Add regression tests for Codex batch execution in the self-heal pipeline"
slug: "add-regression-tests-for-codex-batch"
intent: "Cover the hardened scoping with tests that would have caught the original leak. Include a fixture PRD containing a mix of self-heal-tagged and untagged actionable tasks, run the hench selector in self-heal mode, and assert untagged tasks are never returned. Add an end-to-end test that runs a self-heal loop iteration against a seeded PRD and verifies only tagged items advance to in-progress/completed status."
acceptanceCriteria:
  - "At least one integration test executes a self-heal batch with a Codex mock and asserts a successful result"
  - "At least one test asserts that a Codex parse error triggers retry and eventually continues the loop"
  - "Existing Claude self-heal batch tests continue to pass without modification"
  - "Tests are placed in the hench integration test directory and run as part of `pnpm test`"
  - "Unit test on the task selector confirms untagged items are filtered out when self-heal mode is active"
  - "Integration test seeds a PRD with one tagged + one untagged pending task and asserts the untagged task's status is unchanged after a self-heal iteration"
  - "Test suite explicitly fails if the canonical tag constant is changed without updating the fixtures, preventing silent drift"
  - "All new tests pass under pnpm test"
touches:
  - "e0d22237-06af-4147-a3d7-c3a95c202d59"
priority: "high"
tags:
  - "self-heal"
  - "codex"
  - "hench"
  - "testing"
source: "smart-add"
---
