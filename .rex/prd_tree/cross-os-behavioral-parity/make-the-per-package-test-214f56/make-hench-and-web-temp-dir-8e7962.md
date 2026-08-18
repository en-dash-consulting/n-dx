---
id: "8e79620a-b732-4fe7-b414-be6719b9b9b9"
level: "task"
title: "Make hench and web temp-dir cleanup survive Windows file locking (EBUSY)"
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
  - "All four cases pass on Windows across at least 5 consecutive runs, not just once"
  - "Cleanup still happens — the fix does not skip removal or swallow the error"
  - "The approach awaits real child exit or uses fs.rm's built-in retry, rather than a fixed sleep"
  - "No temp directory is left behind after either suite runs"
  - "The same tests still pass on POSIX"
description: "Four failures across two packages, one cause.\n\n  hench tests/unit/tools/shell.test.ts — \"handles command timeout\", \"respects custom timeout parameter\"\n  web   tests/unit/server/routes-hench-execute.test.ts — \"accepts pending task and returns 202\",\n        \"accepts blocked task and returns 202\"\n  Error: EBUSY: resource busy or locked, rmdir 'C:\\Users\\...\\AppData\\Local\\Temp\\<fixture>-XXXXXX'\n\nEach test spawns a process, then removes its temp directory. On Windows a directory cannot be removed\nwhile any process still holds a handle inside it, and a just-terminated child has not necessarily\nreleased its handles by the time cleanup runs. POSIX permits unlinking a file that is still open, which\nis why this never fires on Linux or macOS.\n\nWEB'S PAIR IS INTERMITTENT AND HENCH'S IS NOT — worth understanding rather than treating as one bug.\nweb's two appeared in two of three consecutive runs; hench's appeared in all of them. That is consistent\nwith a race whose outcome depends on how quickly the child exits: hench's cases deliberately trigger a\nTIMEOUT (so the child is killed and its handles linger), while web's spawn completes normally and usually\nreleases in time. The flakiness is the tell that this is a timing race, not a deterministic leak.\n\nCONNECTED TO THE TERMINATION WORK, and worth reading in that light: killing a process on Windows does\nnot immediately free its file handles — the same asymmetry that motivated `terminateTree`'s taskkill\npath in packages/core/child-lifecycle.js. This is the test-side manifestation of it.\n\nFIX OPTIONS, in preference order:\n1. Await the child's actual exit before cleanup, rather than assuming a timeout means it is gone. If the\n   code under test does not expose that, a short poll on process liveness is still more honest than a\n   fixed sleep.\n2. Retry the rmdir with a small backoff. Node's fs.rm supports { maxRetries, retryDelay } specifically\n   for this Windows behaviour — the least-invasive option and purpose-built for it.\n3. A fixed delay is the weakest choice; it either flakes on a slow machine or wastes time on a fast one.\n\nDO NOT resolve this by dropping the cleanup or ignoring the error — leaked temp directories are the other\nfailure mode, and this suite already leaves debris behind elsewhere (rex's perf tests wrote\npackages/rex/.profile-tests-tmp into the working tree, observed three times in one session). Cleanup that\nreliably works is the goal, not cleanup that silently gives up.\n\nBecause web's pair is intermittent, verify the fix by running the affected files repeatedly (at least 5\nconsecutive runs) on Windows — a single green run proves nothing for a race."
---
