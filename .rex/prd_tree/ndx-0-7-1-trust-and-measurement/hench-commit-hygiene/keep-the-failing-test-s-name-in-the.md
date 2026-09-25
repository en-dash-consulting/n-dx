---
id: "338d1a30-9e8e-4431-a572-b9bb58c3d6a2"
level: "task"
title: "Keep the failing test's name in the stored test-gate output"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "pr-c2"
  - "hench"
  - "test-gate"
source: "PR M execution, 2026-09-24 (run 6eacca42)"
acceptanceCriteria:
  - "Given gate output where one FAIL line is followed by more than the tail's size of stderr, the run record and the printed gate failure name the failing test file and test."
  - "The per-suite PASS/FAIL summary from scripts/run-all-tests.mjs is kept whole."
  - "Output with no FAIL line (a timeout or a crash) still records the tail as today."
description: "Run 6eacca42's gate failed on `tests/e2e/cli-config.test.js`, but the run record's `testGate.packages[0].failureOutput`, `outputTail` and `diagnostics.testGateOutputTail` (23 KB each) held only stderr from passing web tests, such as polling-state's deliberate \"dispose boom\" errors. No `FAIL` line and no suite summary survived, so the failure could be found only by rerunning the suite (6 minutes). `test-gate-failure-diagnostics.md` is meant to prevent exactly this. Extract the vitest `FAIL` lines, the per-suite summary and the failing assertion separately from the tail, so a large stderr stream cannot push them out."
lastModified: "2026-09-24T20:30:27.221Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
