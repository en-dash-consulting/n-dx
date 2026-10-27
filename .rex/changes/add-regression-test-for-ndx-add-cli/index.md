---
id: "caf6319e-35fa-4b12-90b9-74440b2a753f"
type: "change"
title: "Add regression test for ndx add CLI delegation"
slug: "add-regression-test-for-ndx-add-cli"
intent: "Add a test to `tests/e2e/` (or the appropriate orchestration test file) that invokes `ndx add` against a fixture project with a valid `.rex/` directory and asserts it exits cleanly and produces the expected PRD output. This prevents the delegation bug from regressing silently."
acceptanceCriteria:
  - "Test invokes `ndx add` via child_process spawn against a fixture or temp directory with an initialized `.rex/`"
  - "Test asserts exit code 0 and absence of 'missing .rex' or stack-trace output"
  - "Test is wired into the existing e2e test suite and passes in CI"
touches:
  - "31fa50b1-31fc-48f3-a311-341ddbd510de"
priority: "high"
tags:
  - "cli"
  - "test"
  - "regression"
  - "orchestration"
source: "smart-add"
---
