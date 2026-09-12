---
id: "989494aa-521e-42dc-89a4-5927f6b74c79"
level: "task"
title: "Livelock intercept does not kill its child on Windows, failing CLI Smoke (Windows)"
status: "pending"
priority: "high"
startedAt: "2026-09-12T19:14:42.940Z"
acceptanceCriteria: []
description: "PR #370 — Windows CLI Smoke follow-up.\n\nThe original Windows child-cleanup defect is addressed by commit 0b1d4627: both livelock and plan-mode interception now terminate the spawned process tree through the llm-client gateway. In CI run 34715265583, the real-child livelock and plan-mode termination cases passed on Windows.\n\nCURRENT BLOCKER\nThe same Windows run failed one different case:\npackages/hench/tests/integration/livelock-cli-spawn.test.ts\n“reports turns while the spawn is still running”\nAssertionError at line 155: expected 0 to be greater than 0.\n\nCAUSE TO ADDRESS\nThe test samples progress.turns after a fixed 100 ms sleep. Under a busy Windows CI runner, the fake child may not have emitted its first stream event yet, so the sample is zero. This is timing-sensitive test synchronization, not evidence that the process-tree termination failed.\n\nREQUIRED FIX\nReplace the fixed-delay assertion with deterministic synchronization: wait, bounded by the test timeout, until the fake CLI has emitted at least one turn; verify the spawn is still pending at that point; then allow it to complete and assert the final result. Do not skip, weaken, or remove the Windows real-child termination assertions.\n\nACCEPTANCE CRITERIA\n- CLI Smoke (Windows) passes on this branch.\n- The livelock intercept terminates a real child on Windows.\n- The plan-mode intercept terminates a real child on Windows.\n- The mid-spawn progress test is deterministic under CI load and proves a nonzero turn count before the spawn completes.\n- A patch changeset for @n-dx/hench remains present."
lastModified: "2026-09-12T21:21:09.338Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
