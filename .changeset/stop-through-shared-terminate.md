---
"@n-dx/core": patch
---

`ndx start stop` now terminates the background server's children, not just the recorded PID.

The stop path signalled only the PID from `.n-dx-web.pid`. On Windows that is doubly insufficient: SIGTERM is `TerminateProcess`, so the server never ran its cleanup handlers, and nothing walked the tree — so any `rex analyze` or `hench run` the server had spawned survived, potentially holding the port or the workspace. The server is also started `detached: true`, which places it outside libuv's job object, so nothing else would have reaped those children either.

Stop now routes through a shared `terminateTreeByPid` in `child-lifecycle.js`: `taskkill /T` on Windows, a process-group signal on POSIX. Grace periods are unchanged — `ndx start stop` keeps its 2s default and the `N_DX_STOP_GRACE_MS` override, deliberately shorter than the 5s used for shutdown, so consolidating the mechanism does not change stop latency.

There were three copies of the SIGTERM → grace → SIGKILL escalation (`child-lifecycle.js`, `web.js`, `cli.js`); there is now one, written against injected signal/liveness/wait capabilities so a live `ChildProcess`, a bare PID, and a POSIX process group all share the same sequence instead of each drifting. A PID is weaker evidence than a handle — `kill(pid, 0)` cannot distinguish a live process from a zombie or a recycled PID — so pid-file staleness handling stays with the callers that own the file rather than being assumed away.
