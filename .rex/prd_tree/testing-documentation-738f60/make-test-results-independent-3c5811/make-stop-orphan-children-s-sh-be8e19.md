---
id: "be8e19c3-4241-441b-ab1e-1bf25837e8ff"
level: "task"
title: "Make stop-orphan-children's sh dependency explicit instead of failing opaquely"
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
  - "When `sh` cannot be resolved, the test reports that fact directly — the failure or skip message names the missing shell, rather than surfacing a bare `expected false to be true` from a 5s waitFor timeout"
  - "The stand-in server's `sh -c` spawn no longer discards its own failure: a spawn error is observable to the test rather than swallowed by `stdio: 'ignore'`"
  - "Running from a shell with no `sh` on PATH (PowerShell/cmd.exe) does not produce a false failure of the orphan-kill property — it either passes or skips with an explicit, stated reason"
  - "The test still spawns its grandchild through a shell (`sh -c` or `cmd.exe`), so the child escapes libuv's Windows job object and the tree remains non-trivially reaped — the fix must not make the test vacuous by spawning node directly"
  - "Verified red-then-green in both environments: the test passes from Git Bash and from PowerShell on the same commit, and its diagnosis path is demonstrated by running it with `sh` made unavailable"
description: "`tests/e2e/stop-orphan-children.test.js` silently depends on `sh` being resolvable on PATH, so its result varies with the ambient shell rather than with the behavior under test.\n\nThe stand-in server it writes does `spawn('sh', ['-c', 'node child.js'], { cwd: __dirname, stdio: 'ignore' })`. When `sh` is absent — a plain PowerShell or cmd.exe session on Windows, where Git's `usr/bin` is not on PATH — that spawn fails, nothing is reported because stdio is ignored, the grandchild never writes `child.pid`, and the `waitFor` on line 133 burns its full 5000 ms before reporting `AssertionError: expected false to be true`. Nothing in that message points at `sh`.\n\nConfirmed empirically: the test fails from PowerShell (`sh` unresolvable) and passes from Git Bash (`sh` at `/usr/bin/sh`) on the same commit, with the same code under test. It also passes in CI, where the Windows runner has Git's bin directory on PATH — so this misleads a local developer rather than breaking the pipeline, and presents as a failure of the orphan-kill property when that property is fine.\n\nThe `sh` indirection must be preserved, not removed. The test's own comments record why: libuv assigns every non-detached child it spawns on Windows to a global job object, so a node process spawning node directly is already reaped when its parent dies, and a stand-in built that way passes even against the old pid-only kill. An earlier version of this test was vacuous for exactly that reason. `sh -c` (and `cmd.exe`, via spawnCli) is what escapes the job object, which is the tree worth testing.\n\nSo the fix is diagnosis, not removal: resolve `sh` explicitly and/or stop discarding the spawn's failure, so an unavailable shell announces itself instead of masquerading as a surviving orphan."
---
