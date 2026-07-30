---
id: "5d0a6670-7a22-47b5-ac9c-7309ca2032e2"
level: "task"
title: "Investigate flaky store-roundtrip concurrency test (0 items after serialized mutations)"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "flaky-test"
  - "concurrency"
  - "store"
source: "test-flake-triage"
startedAt: "2026-07-24T15:09:49.978Z"
completedAt: "2026-07-24T18:29:51.992Z"
endedAt: "2026-07-24T18:29:51.992Z"
resolutionType: "code-change"
resolutionDetail: "In-process mutex + ownership-token compare-and-delete release in file-lock.ts; same-pid lock files treated as orphans; deterministic repro via injectable staleMs unit test. store-roundtrip test unchanged, 10/10 stress runs green."
acceptanceCriteria:
  - "Root cause of the 0-item read is identified with a deterministic or high-probability reproduction"
  - "file-lock.ts release() cannot unlink a lock it no longer owns (ownership token or equivalent)"
  - "Same-process lock waiters never treat a live in-process holder as stale, regardless of hold duration"
  - "store-roundtrip concurrency test passes reliably under full-suite load (no skip/disable)"
description: "tests/integration/store-roundtrip.test.ts > \"serializes rapid single-file mutations without corrupting folder tree\" failed once during a full-suite run on 2026-07-20 (loadDocument returned 0 items where 2 were expected — even the epic added and awaited BEFORE the concurrent Promise.all block was missing). Passes 3/3 in isolation and passed an identical full-suite run an hour earlier, so it is load-dependent. Suspects found during triage of packages/rex/src/store/file-lock.ts: (1) STALE_LOCK_MS=30s staleness is judged by lock-file timestamp even when the holder PID is the SAME live process — under a CPU-starved full suite a >30s critical section lets the second same-process caller unlink the live lock and run concurrently; (2) release() unlinks the lock file by name without verifying ownership, so after a stale takeover the original holder frees the new holder's lock for third parties; concurrent serializeFolderTree runs then interleave removeStaleEntries deletions with the other writer's fresh writes. Neither hazard fully explains a 0-item read on its own — reproduction needed (e.g. run the test under artificial CPU load or with STALE_LOCK_MS lowered). Consider lock ownership tokens (compare-and-delete), an in-process mutex layered in front of the advisory file lock, and/or having parseFolderTree distinguish transient-empty from truly-empty trees."
---
