---
"@n-dx/core": patch
---

Prove the child-lifecycle kill paths against real OS processes.

Every kill path in `packages/core/child-lifecycle.js` was covered exclusively by
`tests/unit/child-lifecycle.test.js`, which drives them through a fake
ChildProcess and injected signallers and asserts *which strategy ran*. Replace
any of those implementations with one that records the right signal and delivers
nothing and the suite still passes — so the module whose one job is not leaking
processes had no test proving it does not leak one. Two earlier items chose that
scope deliberately; the accumulated result was a foundation nothing verified.

`tests/integration/terminate-tree-liveness.test.js` now watches real pids stop
answering `kill(pid, 0)`: `terminateTree` kills a detached child *and* its
grandchild through the process group; the direct-child fallback kills a child
leading no group; fixtures that install an empty SIGTERM handler prove the
escalation delivers a real SIGKILL rather than merely reaching its second phase;
and `terminateTreeByPid` kills a process, and a whole tree, addressed only by pid
with no ChildProcess handle held anywhere in the test process — a short-lived
launcher spawns the tree detached and exits, so it is reparented to init exactly
like the background server whose pid `ndx start stop` reads out of a file. Each
case was verified red against a no-op mutant of its own delivery site.

The Windows `taskkill /T /F` path keeps its injected-argv assertions, and the
module header now says why: libuv puts a node-spawns-node tree in a global job
object that reaps it regardless, so a liveness assertion there would pass without
proving a kill reached anyone. That header also records which test proves which
path, so the next reviewer reads the coverage map instead of re-deriving it.

No production behaviour changes. The real-process fixtures move to
`tests/helpers/real-process-tree.js`, shared with the late-arrival suite that had
its own copies.
