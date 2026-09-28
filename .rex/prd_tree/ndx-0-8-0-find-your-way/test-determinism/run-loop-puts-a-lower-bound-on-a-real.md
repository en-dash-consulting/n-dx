---
id: "26ce64cf-a0e4-4ac7-ad61-92973dce3b96"
level: "task"
title: "run-loop puts a lower bound on a real timer and dom-performance-monitor keeps an absolute count budget"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "Registered in tests/wall-clock-assertion-inventory.md under Open. Two remaining clock-decided assertions that need different fixes. (1) packages/hench/tests/unit/cli/commands/run-loop.test.ts:75 asserts expect(elapsed).toBeGreaterThanOrEqual(40) around a real loopPause(50). A LOWER bound cannot be made load-robust by scaling — BUDGET_MULTIPLIER only helps an upper bound — and a coarse or early-firing platform timer under-fires it. Use vi.useFakeTimers() and advance deterministically; the claim is 'loopPause waits for its delay', which fake timers assert exactly. (2) packages/web/tests/unit/viewer/dom-performance-monitor.test.ts:824 asserts expect(elapsed).toBeLessThan(COUNT_1000_BUDGET_MS) where the budget is gated on CODEX_CI but not on NDX_TEST_TIME_MULTIPLIER. That same file already counts firstChild/nextSibling/parentNode accesses for its linearity claim at line 881, so technique 1 is available in place — extend the existing counter to cover the 1000-element case and drop the millisecond budget. Update the inventory rows when done."
lastModified: "2026-09-09T20:56:29.568Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
