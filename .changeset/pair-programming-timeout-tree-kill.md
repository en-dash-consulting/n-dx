---
"@n-dx/core": patch
---

Stop `ndx pair-programming` orphaning processes when a reviewer CLI or test command times out.

All three timeout paths in `pair-programming.js` signalled only the direct child with a bare `child.kill("SIGTERM")`. That was four separate defects: no tree kill, so descendants survived; no process group to signal on POSIX; no escalation, so a child that ignores SIGTERM outlived its own timeout indefinitely; and `resolve()` on the line after `kill()`, so the caller saw `timedOut: true` while the tree was still running and still holding the workspace and any port it had bound.

`runShellTestCommand` was the worst of the three and broken deterministically rather than by race: it spawns with `shell: true`, so the child being signalled *is* the shell and never the test command beneath it. A timed-out `npm test` kept building with its output pipe already abandoned.

All three now terminate through `child-lifecycle.js`'s `terminateTree` — process group on POSIX, `taskkill /T` on Windows, escalating to SIGKILL — and **await** it before resolving, so `timedOut` cannot be observed while the tree is alive. Each spawn passes `treeKillSpawnOptions()` so the POSIX group-signal path has a group to signal.

Detaching for that group had a catch worth naming: a detached child leaves this process's foreground group, so Ctrl-C would no longer have reached it — trading a timeout orphan for an interrupt orphan. `cli.js` now registers these children with the tracker whose SIGINT/SIGTERM/SIGHUP handlers already terminate tracked trees, via a new `registerChild` injection seam.

Covered by real-process tests (`tests/e2e/pair-programming-timeout-tree-kill.test.js`) that assert the grandchild is dead *without polling* — the promise settling early is precisely the defect — and that a SIGTERM-ignoring command still dies.
