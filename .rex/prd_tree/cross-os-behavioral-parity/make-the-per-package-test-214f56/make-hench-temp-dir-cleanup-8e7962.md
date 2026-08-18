---
id: "8e79620a-b732-4fe7-b414-be6719b9b9b9"
level: "task"
title: "Make hench temp-dir cleanup survive Windows file locking (EBUSY)"
status: "pending"
priority: "medium"
tags:
  - "cross-os"
  - "windows"
  - "testing"
  - "hench"
  - "process-lifecycle"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "Both timeout cases pass on Windows across at least 5 consecutive runs, not just once"
  - "Cleanup still happens — the fix does not skip removal or swallow the error"
  - "The approach awaits real child exit or uses fs.rm's built-in retry, rather than a fixed sleep"
  - "No temp directory is left behind after the suite runs"
  - "The same tests still pass on POSIX"
description: "Two failures in tests/unit/tools/shell.test.ts, both in the timeout-handling describe:\n  \"handles command timeout\"\n  \"respects custom timeout parameter\"\n  Error: EBUSY: resource busy or locked, rmdir 'C:\\Users\\...\\AppData\\Local\\Temp\\hench-test-shell-XXXXXX'\n\nThe test spawns a command, lets it hit the timeout, then removes the temp directory. On Windows a\ndirectory cannot be removed while any process still holds a handle inside it, and a just-timed-out\nchild has not necessarily released its handles by the time cleanup runs. POSIX permits unlinking a\nfile that is still open, which is why this never fires on Linux or macOS.\n\nCONNECTED TO THE TERMINATION WORK, and worth reading in that light: killing a process on Windows does\nnot immediately free its file handles — the same asymmetry that motivated `terminateTree`'s taskkill\npath in packages/core/child-lifecycle.js. This is the test-side manifestation of it.\n\nFIX OPTIONS, in preference order:\n1. Await the child's actual exit before cleanup, rather than assuming the timeout means it is gone. If\n   toolRunCommand does not expose that, a short poll on process liveness is still more honest than a\n   fixed sleep.\n2. Retry the rmdir with a small backoff. Node's fs.rm supports { maxRetries, retryDelay } specifically\n   for this Windows behaviour — that is the least-invasive option and is purpose-built for it.\n3. A fixed delay is the weakest choice; it either flakes on a slow machine or wastes time on a fast one.\n\nDO NOT resolve this by dropping the cleanup or ignoring the error — leaked temp directories are the\nother failure mode, and this suite already leaves debris behind elsewhere (rex's perf tests write\npackages/rex/.profile-tests-tmp into the working tree, observed three times in one session). Cleanup\nthat reliably works is the goal, not cleanup that silently gives up.\n\nVerify the fix is not merely timing-dependent by running the two cases repeatedly (at least 5\nconsecutive runs) on Windows."
---
