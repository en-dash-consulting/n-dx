---
id: "3d39c1bf-f80e-45d8-b8ea-c7c027e0787b"
level: "task"
title: "pair-programming.js times out with bare SIGTERM — three sites, no tree kill, no escalation, no await"
status: "pending"
priority: "medium"
tags:
  - "cross-os"
  - "process-lifecycle"
  - "core"
  - "correctness"
source: "margin-audit-2026-08-19"
acceptanceCriteria:
  - "All three timeout sites (pair-programming.js:366, :425, :594) terminate via the child-lifecycle.js tree-kill contract instead of bare child.kill(\"SIGTERM\")"
  - "Each spawn site passes treeKillSpawnOptions so the POSIX group-signal fast path is available rather than falling back to enumeration"
  - "The returned promise does not settle until termination completes — a caller cannot observe timedOut: true while the tree is still running"
  - "runShellTestCommand's grandchildren are proven dead by a real-process test, not just the shell: this is the site where bare SIGTERM orphans deterministically, so it must fail before the fix and pass after"
  - "SIGTERM is escalated to SIGKILL when ignored, pinned by a test using a child that installs a SIGTERM handler and refuses to exit"
  - "The graceful-shutdown SIGTERM-plus-grace policy is NOT applied to these timeout paths, and a comment records why the two policies stay distinct"
description: "The one remaining place that never got the child-lifecycle.js treatment. Verified 2026-08-19, not inferred.\n\nTHE SITES — all three in packages/core/pair-programming.js, all three TIMEOUT paths:\n\n  366  const timer = setTimeout(() => { child.kill(\"SIGTERM\"); resolve({ exitCode: 1, timedOut: true }); }, timeout);\n  425  same shape, plus captured output\n  594  same shape, inside runShellTestCommand\n\nThat they are timeout paths matters: the campaign's distinction is that graceful shutdown keeps SIGTERM-then-grace, while timeout/runaway paths get the definitive tree kill. These are the latter, so the definitive contract applies and the current code is simply the wrong policy.\n\nFOUR SEPARATE DEFECTS, not one:\n\n1. NO TREE KILL. pair-programming.js imports spawnCli from ./win-spawn.js and raw spawn from node:child_process. It imports NOTHING from ./child-lifecycle.js — no terminateTree, no terminateTreeByPid. So a timeout signals only the direct child and leaves descendants running.\n\n2. NO PROCESS GROUP TO SIGNAL. The spawn sites do not pass treeKillSpawnOptions, so on POSIX there is no process group of their own. This is the same gap 31ae3ddb fixed for exec (\"spawn exec's children so POSIX gets a real process group\") — the fast path that makes a group kill atomic is unavailable here.\n\n3. NO ESCALATION. SIGTERM can be caught, blocked, or ignored. There is no SIGKILL follow-up, so a child that ignores SIGTERM survives its own timeout indefinitely.\n\n4. THE PROMISE RESOLVES WITHOUT AWAITING TERMINATION. Each site calls resolve() on the line after kill(). The caller observes \"timedOut: true\" and proceeds while the tree may still be running and still holding the cwd, files, and ports.\n\nSITE 594 IS THE WORST, AND IS PROVABLY BROKEN TODAY. runShellTestCommand spawns with shell: true, so `child` IS the shell, not the test command. SIGTERM to the shell does not propagate to the command it launched — the textbook orphan case. A timed-out test command keeps running with its output pipe detached. This is the site to write a real-process test against, because it does not need a race to fail.\n\nSUGGESTED FIX: route all three through the unified contract in packages/core/child-lifecycle.js (terminateTree, which already handles enumeration and escalation), await it before resolving, and pass treeKillSpawnOptions at each spawn so POSIX has a real group. Same tier — child-lifecycle.js and pair-programming.js are both packages/core — so this is an ordinary import, not a boundary crossing.\n\nDO NOT reuse the graceful-shutdown policy here. Freezing or hard-killing is correct on a timeout; the SIGTERM grace period belongs to Ctrl-C on `ndx start`, and 71e44890 records why the two policies are mutually exclusive."
---
