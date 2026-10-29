---
id: "d2ae6bd7-a3b1-425f-957e-1e5654bd9b1c"
type: "task"
title: "Give stop-orphan-children's grandchild ready wait a Windows-sized timeout and report elapsed time"
slug: "give-stop-orphan-children-s-grandchild"
description: "GitHub #785. tests/e2e/stop-orphan-children.test.js › \"kills the child, not just the recorded server pid\" failed on Tests (Windows, root+llm-client) with \"The stand-in server's grandchild never started ... looks like a genuine failure\", and no launch error recorded. The test waits for the shell-launched Node grandchild with `waitFor(childReady)` and waitFor's default 5,000 ms (around line 283). A shell-launched Node process on a Windows runner can take longer than that to start (antivirus, cold cache), so the wait gives up on a healthy but slow child and the message calls it a genuine failure.\n\nFix:\n- Give the grandchild ready wait a longer timeout on Windows (about 20 s); keep 5 s elsewhere. Make sure the it() timeout still covers the server wait + this wait + the kill waits.\n- Put the elapsed time and the timeout in the error, and what was observed at the deadline (whether a child pid was recorded, whether that pid is alive, the tick count), so a slow start can be told apart from a missing one.\n- Do not weaken what the test proves: the grandchild must still be ready, alive and ticking before terminateTreeByPid runs, and both the server and the grandchild must be dead afterwards.\n\nWall clock: this file is already listed in tests/wall-clock-assertion-inventory.md (Open, waiting on a spawned process). Keep tests/e2e/wall-clock-inventory-policy.test.js green; if the policy needs the entry updated, update it in the same commit.\n\nProof: force a slow grandchild locally (for example a temporary delay before it writes its ready file, and the Windows timeout applied on macOS) to show the old 5 s wait fails and the new one passes; revert the forcing before committing.\n\nTest-only: change the test file(s) named here and nothing in product code. If the flake turns out to be a real product bug, stop and record that instead of fixing the product. These flakes do not reproduce on macOS, so the fix must be correct from the failure as recorded; where cheap, force the condition locally to show the old test fails and the new one passes."
acceptanceCriteria:
  - "Closes #785"
  - "On win32 the grandchild ready wait allows about 20 s; other platforms keep 5 s; the test's own timeout covers the longest path"
  - "The ready-wait failure message includes the elapsed time, the timeout, and what was observed at the deadline (child pid recorded, alive, tick count)"
  - "The test still requires a ready, alive, ticking grandchild before terminateTreeByPid, and asserts both the server and the grandchild die"
  - "wall-clock-inventory-policy passes, with tests/wall-clock-assertion-inventory.md updated in the same commit if the policy requires it"
  - "The completion note records the forced-slow-child check: old wait fails, new wait passes"
priority: "high"
tags:
  - "flaky-test"
  - "ci-reliability"
  - "issue-cleanup"
source: "ndx-capture"
---
