---
id: "518ece53-aad7-4902-a899-9de45f6635d8"
level: "task"
title: "Real-timer ordering assertions are load-sensitive and invisible to the wall-clock inventory scanner"
status: "pending"
priority: "low"
acceptanceCriteria: []
description: "Registered in tests/wall-clock-assertion-inventory.md under 'Not clock-derived, but load-sensitive for a different reason'. These assert an ORDERING or a COUNT produced by real timers rather than an elapsed duration, so tests/e2e/wall-clock-inventory-policy.test.js cannot detect them — its detector requires a duration identifier. They were listed by hand and the list will go stale.\n\nKnown sites: packages/web/tests/unit/server/register-scheduler.test.ts:159,180 (15-30ms intervals observed over a 100-150ms real window; a starved event loop yields zero ticks and maxConcurrent becomes 0); packages/web/tests/integration/seam-register-scheduler.test.ts:83,121,166 (10ms intervals, 50-100ms real waits); packages/hench/tests/unit/store/run-retention-scheduler.test.ts:256 (50ms interval, 600ms wait — the comment already acknowledges 100-200ms event-loop delays and the response was widening the window, not removing the dependency); packages/rex/tests/unit/store/file-lock.test.ts:75,106 (ordering rests on a real 5ms delay landing inside a 50ms/300ms critical section); packages/hench/tests/unit/queue/execution-queue.test.ts:213,345,346,366,384,385 (real 1-10ms sleeps as the only settling barrier, plus Math.random() at line 361); packages/web/tests/unit/viewer/elapsed-time-memoization.test.ts:138,143 (fixture built from Date.now() a few statements before the assertion reads the clock again; 1s of drift flips the expected string).\n\nTwo pieces of work: convert these to fake timers or to explicit promise gates — packages/rex/tests/integration/concurrent-write-lost-update.test.ts is the worked example of gating, and load cannot reorder its verdict — and extend the inventory policy scanner so the next such site is flagged automatically instead of relying on a hand list."
lastModified: "2026-09-09T20:56:43.454Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
