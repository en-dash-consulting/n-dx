---
"@n-dx/core": patch
---

`ndx start stop` no longer warns that a server "did not exit" when it did.

`terminateTreeByPid` returns whether a pid stopped answering signal 0, which is not the same question as whether the intended process exited: `kill(pid, 0)` succeeds for a zombie — exited but not yet reaped — and for a PID that has since been recycled. SIGKILL is unblockable, so a still-signallable pid after one is weak evidence of survival and strong evidence of nothing.

The two stop paths disagreed about that. `cli.js` discarded the result and explained why; `web.js` branched on it and logged `Server (PID N) did not exit within Nms of SIGKILL.` — directly above the `Stopped ...` line it printed anyway. Stopping a server that exited cleanly could produce both lines, and the warning was the wrong one.

`web.js` now discards the result too. The rationale lives in one place — the contract on `terminateTreeByPid` — with both call sites pointing at it instead of carrying their own copy, and the `@returns` tag corrected: it claimed "whether the pid is gone", contradicting the prose four lines above it.

Where a stop path genuinely needs to report failure, the signal-0 probe belongs *before* the kill, which is where `cli.js` already separates EPERM ("exists, not ours to signal" — a real failure) from ESRCH ("already gone" — success). That behaviour is unchanged.

Guarded by a source assertion rather than a behavioural test: misreporting needs an unreaped zombie in the window between exit and reap, which cannot be staged deterministically, whereas the invariant that produced it — no caller consults the result — checks exactly.
