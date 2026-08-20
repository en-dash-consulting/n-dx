---
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Add a BETA option to make the POSIX timeout kill definitive: freeze the process tree, prove it is frozen, then kill it. **Off by default.**

It ships behind a flag because the sweep it replaces has far more mileage: the freeze path's unit coverage injects its seams, and its behaviour against real POSIX processes is not yet proven in CI. Enable per-project with `ndx config experimental.posixFreezeTreeKill true`, or for a single run with `NDX_POSIX_FREEZE_KILL=1`. `ndx config --help` documents it as BETA and NOT RIGOROUSLY TESTED so nobody turns it on unaware.

The previous approach enumerated descendants and signalled them, which is inference. Its hole is reparenting: a descendant whose parent dies is adopted by init, so the pid→ppid link the enumeration depends on dissolves at exactly the moment the killing starts. The old code collected descendants *before* signalling to work around that; freezing first removes it, because reparenting only happens when a parent exits and nothing exits until enumeration is finished.

On timeout, `exec` now SIGSTOPs the tree, closes over its descendants to a fixpoint — a pass that discovers nothing, rather than a fixed number of rounds — verifies every member reads as stopped in the process table, and only then SIGKILLs, leaves before parents. It terminates because SIGSTOP cannot be caught, blocked, or ignored and a stopped process cannot fork, so new arrivals can only come from processes that were still running at the previous read, and that set shrinks monotonically. When the child *is* a process-group leader the fast path skips enumeration entirely: group membership is inherited rather than listed, so `SIGSTOP` then `SIGKILL` on the group are atomic over the whole tree.

SIGKILL, never SIGTERM: a stopped process does not act on SIGTERM — the signal queues until SIGCONT — so a "graceful" attempt against a frozen tree is a silent no-op. Freezing and graceful termination are therefore mutually exclusive, and this policy is opt-in via `freeze` on `terminateProcessTree`, used only for timeouts and runaways. Graceful shutdown keeps its SIGTERM grace period unchanged, and a test pins that the two policies stay distinct.

Windows is unchanged. It has no pure-JS pause — libuv maps the signals it supports onto TerminateProcess, and the real equivalents all need native code — so `taskkill /T` remains a tree walk. Its failure mode is the mirror image of POSIX's and is now documented where taskkill is invoked: Windows never reparents, so a link survives its parent's death and can dangle onto a recycled pid.

Known limit, recorded in the code: a deliberate double-fork daemon escapes parentage by design and no enumeration finds it. That is a policy question about whether agent-run commands may daemonize, not a detection one.
