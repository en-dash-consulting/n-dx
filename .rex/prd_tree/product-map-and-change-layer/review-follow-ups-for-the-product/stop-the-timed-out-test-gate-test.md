---
id: "d83ed5c6-d891-4cfb-a472-daef00423932"
level: "task"
title: "Stop the timed-out test gate test racing its fake gate startup"
status: "completed"
priority: "high"
startedAt: "2026-10-07T19:50:47.014Z"
completedAt: "2026-10-07T19:56:35.624Z"
endedAt: "2026-10-07T19:56:35.624Z"
resolutionType: "code-change"
resolutionDetail: "Timed-out gate test: fullTestTimeoutMs 1000→5000, firstSleep 10→30, so the timeout lands in the sleep after the call is logged. All assertions kept. 20/20 consecutive runs; hench suite 4663 pass; root-policy green. Changeset test-gate-timeout-test-startup.md."
acceptanceCriteria: []
description: "Fixes GitHub issue #564 (read it with gh issue view 564). packages/hench/tests/integration/test-gate-flaky-rerun.test.ts 'does not re-run a gate that timed out' (around line 215) gives the fake gate script fullTestTimeoutMs 1000 and firstSleep 10, then asserts calls() has length 1. The script records its call on its first line, and on the Windows CI runner starting sh under parallel load can exceed 1 s, so the gate is killed before calls.log is written and calls() returns an empty list. Make the test deterministic without weakening it: give the gate time to start (for example fullTestTimeoutMs 5000 with firstSleep 30, so the timeout always lands inside the sleep), or wait until calls.log exists before the timeout can fire. Keep the assertions that a timed-out gate fails the run, reports the timeout, and is never re-run. Test-only change unless the gate code itself is wrong. Acceptance criteria: (1) the test no longer depends on the fake gate starting within 1 s; (2) it still asserts the run failed, the error names the timeout, testGate has no rerun, and the gate ran exactly once; (3) the file passes 20 consecutive local runs and under parallel load with npx vitest run --root packages/hench; (4) the test's runtime stays reasonable (well under the suite's per-test timeout); (5) a patch changeset for @n-dx/hench references #564."
lastModified: "2026-10-07T19:56:35.844Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
