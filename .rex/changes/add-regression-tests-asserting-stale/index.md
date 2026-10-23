---
id: "4cabb3da-ccac-42f2-9bdb-43fce6da3743"
type: "change"
title: "Add regression tests asserting stale-setup notice fires only on missing tool directories"
slug: "add-regression-tests-asserting-stale"
intent: "Add CLI integration tests that exercise the stale-setup detection helper across the matrix of directory presence states. Verify the message is suppressed when all three directories exist and emitted (with correct missing-directory naming) when any subset is absent. Cover at least one end-to-end CLI invocation per state to catch regressions where new commands re-introduce extra trigger conditions."
acceptanceCriteria:
  - "Test covers the all-present case and asserts no stale-setup output is produced"
  - "Tests cover each single-missing-directory case and assert the missing directory is named in the output"
  - "Test covers the all-missing case and asserts all three directories are named"
  - "Tests run as part of the standard CLI integration test suite"
touches:
  - "2037c955-24ba-4fc4-9d3f-6f17ddd70139"
priority: "medium"
tags:
  - "cli"
  - "tests"
  - "regression"
source: "smart-add"
---
