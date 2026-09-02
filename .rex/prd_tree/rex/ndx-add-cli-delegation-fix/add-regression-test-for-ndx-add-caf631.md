---
id: "caf6319e-35fa-4b12-90b9-74440b2a753f"
level: "task"
title: "Add regression test for ndx add CLI delegation"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "test"
  - "regression"
  - "orchestration"
source: "smart-add"
startedAt: "2026-03-19T18:47:08.893Z"
completedAt: "2026-03-19T18:48:18.205Z"
resolutionType: "code-change"
resolutionDetail: "Added tests/e2e/cli-add.test.js with 3 tests: successful manual-mode delegation, missing-.rex user-friendly error, and exit code propagation on failure."
acceptanceCriteria:
  - "Test invokes `ndx add` via child_process spawn against a fixture or temp directory with an initialized `.rex/`"
  - "Test asserts exit code 0 and absence of 'missing .rex' or stack-trace output"
  - "Test is wired into the existing e2e test suite and passes in CI"
description: "Add a test to `tests/e2e/` (or the appropriate orchestration test file) that invokes `ndx add` against a fixture project with a valid `.rex/` directory and asserts it exits cleanly and produces the expected PRD output. This prevents the delegation bug from regressing silently."
---
