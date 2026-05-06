---
id: "4cabb3da-ccac-42f2-9bdb-43fce6da3743"
level: "task"
title: "Add regression tests asserting stale-setup notice fires only on missing tool directories"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "tests"
  - "regression"
source: "smart-add"
startedAt: "2026-05-06T13:08:49.974Z"
completedAt: "2026-05-06T13:22:09.131Z"
endedAt: "2026-05-06T13:22:09.131Z"
resolutionType: "code-change"
resolutionDetail: "Created tests/e2e/cli-stale-check.test.js with 14 integration tests covering stale-setup detection across all directory presence states. Tests verify message suppression when all directories exist, emission of correct missing-directory names when any subset absent, and that the check integrates properly with CLI without interference. All acceptance criteria met. Tests passing (1626/1628, 1 pre-existing failure)."
acceptanceCriteria:
  - "Test covers the all-present case and asserts no stale-setup output is produced"
  - "Tests cover each single-missing-directory case and assert the missing directory is named in the output"
  - "Test covers the all-missing case and asserts all three directories are named"
  - "Tests run as part of the standard CLI integration test suite"
description: "Add CLI integration tests that exercise the stale-setup detection helper across the matrix of directory presence states. Verify the message is suppressed when all three directories exist and emitted (with correct missing-directory naming) when any subset is absent. Cover at least one end-to-end CLI invocation per state to catch regressions where new commands re-introduce extra trigger conditions."
---

# Add regression tests asserting stale-setup notice fires only on missing tool directories

🟡 [completed]

## Summary

Add CLI integration tests that exercise the stale-setup detection helper across the matrix of directory presence states. Verify the message is suppressed when all three directories exist and emitted (with correct missing-directory naming) when any subset is absent. Cover at least one end-to-end CLI invocation per state to catch regressions where new commands re-introduce extra trigger conditions.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** cli, tests, regression
- **Level:** task
- **Started:** 2026-05-06T13:08:49.974Z
- **Completed:** 2026-05-06T13:22:09.131Z
- **Duration:** 13m
