---
id: "8f4878b4-9492-40fe-8256-91b8379221a3"
level: "task"
title: "Windows mtime granularity defeats the incremental usage aggregator's change detection"
status: "completed"
priority: "high"
tags:
  - "cross-os"
  - "windows"
  - "web"
  - "correctness"
  - "testing"
startedAt: "2026-08-18T20:12:06.300Z"
completedAt: "2026-08-18T20:30:25.457Z"
endedAt: "2026-08-18T20:30:25.457Z"
acceptanceCriteria:
  - "A same-size rewrite of a run file is detected as changed on Windows, demonstrated by a test that rewrites with equal-length content and asserts the aggregation follows"
  - "The fix does not rely on the two payloads differing in length, nor on a sleep between writes"
  - "The existing 'handles task ID change in a modified file' case passes under the aggregated runner (node scripts/run-all-tests.mjs packages), not only standalone — verified across at least 5 consecutive runs on Windows"
  - "The mtime+size docblock records the Windows granularity caveat and the chosen strategy"
  - "The same tests still pass on POSIX"
description: "IncrementalTaskUsageAggregator decides whether a run file changed by comparing mtime + size:\n\n  packages/web/src/server/task-usage/incremental-task-usage.ts:185\n    } else if (prev.mtimeMs !== snapshot.mtimeMs || prev.size !== snapshot.size) {\n\nOn Windows that misses same-size rewrites. Measured directly — 200 iterations of write / stat / rewrite-with-same-size / stat:\n\n  same-size rewrites where mtimeMs did NOT change: 163/200\n\nWindows file timestamps advance on a ~15.6ms system tick rather than continuously, so two writes inside the same tick are indistinguishable when the size is unchanged. ext4 records nanoseconds, which is why ubuntu CI has never seen this.\n\nHOW IT SURFACED: while measuring the cost of adding per-package suites to the Windows CI job (2b2b78ad), the aggregated run failed where the same suite passes standalone:\n\n  FAIL tests/unit/server/incremental-task-usage.test.ts\n       > incremental: modified files > handles task ID change in a modified file\n  AssertionError: expected { totalTokens: 150, runCount: 1 } to be undefined\n\nThat test rewrites run-1.json changing only \"task-a\" to \"task-b\" — byte-identical length — so detection rests entirely on mtime. The stale task-a entry survives. It passed 5/5 standalone and failed under the aggregated run: a genuine race, not a deterministic break.\n\nTHIS IS A PRODUCTION DEFECT, NOT ONLY A TEST ARTIFACT. A run file rewritten to the same length within one tick is silently ignored by the dashboard's aggregation, so token totals attributed to the wrong task persist until some other change to that file forces a re-read. Run records are rewritten in place (status transitions, summary backfill), and a same-length edit is not exotic — a taskId or status swap of equal length does it.\n\nDO NOT fix this by making the test's two payloads different lengths, or by sleeping between writes. Either hides the defect while leaving production able to miss a real modification.\n\nFIX OPTIONS:\n1. Add a cheap content signal to the snapshot — a hash of the file bytes, or of taskId + tokens. Run JSON files are small and already fully parsed on the paths that matter, so the extra cost is bounded. This is the only option that closes the hole rather than narrowing it.\n2. Treat \"size unchanged AND mtime within one granularity tick of the previous snapshot\" as CHANGED (re-read rather than trust). Cheaper, still heuristic, and re-reads more often than needed on Windows.\n3. Compare bigint mtimeNs. Does NOT work — the coarse value comes from the filesystem, not from Node's precision, so a wider type reports the same unchanged number.\n\nNote the docblock at incremental-task-usage.ts:15 states the mtime+size strategy as settled; update it with the Windows caveat and whichever option is chosen."
---
