---
id: "be8e19c3-4241-441b-ab1e-1bf25837e8ff"
level: "task"
title: "Make the tests' sh-on-PATH dependency explicit instead of failing opaquely"
status: "pending"
priority: "medium"
tags:
  - "testing"
  - "windows"
  - "cross-os"
  - "determinism"
  - "developer-experience"
source: "conversation-2026-08-19"
acceptanceCriteria:
  - "An audit lists every test that spawns `sh` (or another shell) and states, per site, whether it is guarded — the two known files were found incidentally, so the true count is unverified"
  - "When `sh` cannot be resolved, each affected test reports that fact directly — the failure or skip message names the missing shell, rather than surfacing a bare `expected false to be true` or an unexplained tree-kill failure"
  - "Shell spawns in tests no longer discard their own failure: a spawn error is observable to the test rather than swallowed by `stdio: 'ignore'`"
  - "Running from a shell with no `sh` on PATH (PowerShell/cmd.exe) produces no false failures in either file — they either pass or skip with an explicit, stated reason"
  - "The tests still spawn their grandchild through a shell, so the child escapes libuv's Windows job object and the tree remains non-trivially reaped — the fix must not make them vacuous by spawning node directly"
  - "Verified in both environments: the affected tests pass from Git Bash and from PowerShell on the same commit, and the diagnosis path is demonstrated by running them with `sh` made unavailable"
description: "Several tests silently depend on `sh` being resolvable on PATH, so their results vary with the ambient shell rather than with the behavior under test. Two files are known to be affected:\n\n- `tests/e2e/stop-orphan-children.test.js` — its stand-in server does `spawn('sh', ['-c', 'node child.js'], { cwd: __dirname, stdio: 'ignore' })`. When `sh` is absent the spawn fails, stdio is ignored so nothing is reported, the grandchild never writes `child.pid`, and the `waitFor` burns its full 5000 ms before reporting `AssertionError: expected false to be true`. 1 test.\n- `packages/llm-client/tests/integration/exec-timeout-tree-kill.test.ts` — runs `exec(\"sh\", [\"-c\", \"node grandchild.js\"], …)`. 4 tests.\n\nNothing in either failure message points at `sh`.\n\nConfirmed empirically on one commit, no code changes between runs: both files fail from PowerShell (`sh` unresolvable) and pass from Git Bash (`sh` at `/usr/bin/sh`). They also pass in CI, where the Windows runner has Git's bin directory on PATH — so this misleads a local developer rather than breaking the pipeline, and presents as a failure of the behavior under test when that behavior is fine. The cost is real: these 5 tests were twice investigated as suspected regressions during a merge before the shell was identified as the variable.\n\nThe `sh` indirection must be preserved, not removed. Both files record why: libuv assigns every non-detached child it spawns on Windows to a global job object, so a node process spawning node directly is already reaped when its parent dies, and a stand-in built that way passes even against a pid-only kill. An earlier version of the orphan test was vacuous for exactly that reason, and `exec-timeout-tree-kill.test.ts` documents a measurement where a node intermediate left a dead grandchild while `sh` in the same position left a live one. `sh -c` is also the real production path (hench's execShell).\n\nSo the fix is diagnosis, not removal: resolve `sh` explicitly and/or stop discarding the spawn's failure, so an unavailable shell announces itself instead of masquerading as a surviving orphan or a failed tree kill. Sweep for other `spawn('sh'`/`exec(\"sh\"` sites in tests while doing this — these two were found incidentally, not by an audit."
---
