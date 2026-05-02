---
id: "e72caddd-238f-426f-b191-4adec1de560d"
level: "task"
title: "Add regression tests for Codex batch execution in the self-heal pipeline"
status: "completed"
priority: "high"
tags:
  - "self-heal"
  - "codex"
  - "hench"
  - "testing"
source: "smart-add"
startedAt: "2026-04-14T21:20:05.017Z"
completedAt: "2026-04-14T21:28:41.651Z"
acceptanceCriteria:
  - "At least one integration test executes a self-heal batch with a Codex mock and asserts a successful result"
  - "At least one test asserts that a Codex parse error triggers retry and eventually continues the loop"
  - "Existing Claude self-heal batch tests continue to pass without modification"
  - "Tests are placed in the hench integration test directory and run as part of `pnpm test`"
description: "Add integration tests that run the self-heal batch loop against a Codex fixture (recorded or mock CLI output) and assert that batches complete, results are parsed correctly, and the pipeline proceeds to the next step. Include a test for the partial-output and rate-limit error paths to confirm retry behavior. Mirror the existing Claude self-heal tests so both vendor paths are covered symmetrically."
---

# Add regression tests for Codex batch execution in the self-heal pipeline

🟠 [completed]

## Summary

Add integration tests that run the self-heal batch loop against a Codex fixture (recorded or mock CLI output) and assert that batches complete, results are parsed correctly, and the pipeline proceeds to the next step. Include a test for the partial-output and rate-limit error paths to confirm retry behavior. Mirror the existing Claude self-heal tests so both vendor paths are covered symmetrically.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** self-heal, codex, hench, testing
- **Level:** task
- **Started:** 2026-04-14T21:20:05.017Z
- **Completed:** 2026-04-14T21:28:41.651Z
- **Duration:** 8m
