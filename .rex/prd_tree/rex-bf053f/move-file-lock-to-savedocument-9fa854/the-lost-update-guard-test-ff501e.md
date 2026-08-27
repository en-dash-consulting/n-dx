---
id: "ff501eb1-004d-4bae-989d-904d9540a937"
level: "task"
title: "The lost-update guard test intermittently fails under load — either a locking hole or a bad test bound"
status: "pending"
priority: "high"
tags:
  - "prd-correctness"
  - "concurrency"
  - "load-sensitive"
  - "severity:high"
source: "ndx-capture"
acceptanceCriteria:
  - "Reproduced deliberately under synthetic CPU/IO load, so the mechanism can be observed rather than guessed"
  - "Determined whether an acknowledged addItem can actually be lost, or whether the 2s race bound makes the assertion unsound under load"
  - "If the lock has a hole: an acknowledged write is never lost, with a regression test that fails against the current code"
  - "If the bound is at fault: the test no longer depends on a wall-clock race, e.g. it synchronises on lock state rather than a sleep"
  - "addItem's lock-acquisition timeout behaviour under a held lock is documented, including whether it rejects or waits"
  - "The test is not muted, retried, or skipped as a resolution"
description: "Do not read this as \"a flaky test\" and mute it. The assertion that failed is the data-loss guard itself, and the two possible explanations differ enormously in consequence.\n\nOBSERVED once, in packages/rex during a full `pnpm run validate`:\n\n    FAIL tests/integration/concurrent-write-lost-update.test.ts\n         > concurrent PRD writers do not lose updates\n         > an item inserted while update_task_status deletes another survives\n    AssertionError: expected undefined to be true\n      at :156  expect(epicTwo?.children?.some((c) => c.id === \"task-late\")).toBe(true)\n\n1 of 4 tests in the file; the other 211 rex files passed. Trigger was load: I was running an add_item MCP write concurrently with the suite. The file passes 4/4 in isolation and rex was 212/212 on a clean re-run with nothing else touching the repo.\n\nWHY THE FAILURE IS HARD TO DISMISS. The test pauses a writer mid-transaction and launches a competing addItem, then asserts both survive. Line 156 is the second assertion — that the concurrently inserted item was not silently dropped. `await addPromise` on line 148 completed WITHOUT rejecting, so the add reported success; yet task-late is absent from epic-2 in the reloaded document. Read literally, that is a lost update: a write that returned successfully and then vanished.\n\nWHY IT IS ALSO HARD TO CONFIRM. withPauseAfterRead (line 42) proxies withTransaction and fires the pause INSIDE the transaction, so the outer writer holds the PRD file lock throughout the pause. The competing addItem therefore has to block on that lock, which is why the `Promise.race([addPromise, sleep(2_000)])` bound on line 145 effectively always resolves via the 2s sleep — the whole file takes ~5s for 4 tests, consistent with that. On the happy path the pause ends, the transaction commits, the lock releases, and only then does addItem write. Under that model a lost update should not be reachable at all, which is what makes the observed failure interesting rather than routine.\n\nTWO READINGS, and the work is deciding which:\n(a) A real load-dependent hole in the locking — the interleaving the lock is supposed to serialize is not always serialized, and the PRD store can lose an acknowledged write. This is data loss and would be the more important bug in the store.\n(b) A test-bound artifact — under load the 2s race bound expires in a state the assertions do not account for (for example addItem's own lock-acquisition timeout elapsing), so the test asserts an outcome the lock never promised. Then the guard is unreliable rather than the store being wrong.\n\nI could not distinguish them from a single observation and did not try to force one; the reproduction step below is the prerequisite for everything else. Note that (b) still matters: an unreliable guard on PRD data loss is close to no guard, and the temptation on next sight of a red run is to retry or mute it, which would remove the only automated check on this interleaving.\n\nRelated but distinct: the ndx config libuv abort (418b2f4a) is also load-sensitive. Different mechanism, same lesson that this suite's timing assumptions hold only on an idle machine."
lastModified: "2026-08-27T19:04:51.804Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
