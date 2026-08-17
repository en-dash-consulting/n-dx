---
"@n-dx/core": patch
---

Terminate the whole process tree on Windows, behind one cross-OS contract.

`child-lifecycle.js` previously exported `PLATFORM_SUPPORTS_PROCESS_GROUPS` and picked its termination strategy from it, so Windows silently got **direct child kill only** — any grandchild spawned by a tracked child was orphaned. Since `ndx` spawns CLIs that themselves spawn processes (claude/codex), that leak was real rather than theoretical.

A single `terminateTree(child, options)` now owns the decision: POSIX signals the process group (`process.kill(-pgid)`, SIGTERM then SIGKILL); Windows runs `taskkill /PID <pid> /T /F` through `win-spawn.js`. Both fall back to killing the direct child if the tree-wide attempt fails or leaves it running. `PLATFORM_SUPPORTS_PROCESS_GROUPS` is no longer exported, and the `processGroups` tracker option is renamed `treeKill` — it named a POSIX mechanism that does not exist on Windows, where tree-killing nonetheless works.

`cli.js` no longer branches on `process.platform` for termination: the `detached: true` decision moved into an exported `treeKillSpawnOptions()`, so the platform difference lives in the termination layer that owns it.

Also removes the construction-time stderr notice entirely. Gating it behind `NDX_DEBUG_LIFECYCLE` (previous release) stopped it appearing on every command, but its text — "falling back to direct child kill" — is now simply false on Windows. Strategy reporting moved to `terminateTree`, where it names the strategy at the moment one actually runs.

Documented Windows limitations, rather than papered over:

- **No graceful phase.** `taskkill /T` without `/F` posts WM_CLOSE, which only a process pumping a window-message loop acts on — Node children do not — and `process.kill(pid, "SIGTERM")` is `TerminateProcess` anyway. A graceful pass would burn the grace period for nothing, so Windows goes straight to `/F`.
- **Job Objects not used.** They are the architecturally correct primitive (kill-on-job-close is exactly analogous to a process group) but need a native addon, which would put a compiled dependency in a pure-JS orchestration package.
- **Shutdown-time dependency.** taskkill is spawned during cleanup; if the `ndx` process is itself force-killed, no handler runs and the tree survives unless the host contained it.

The `platform`, `spawnCliImpl`, and `killGroup` seams are injectable so **both** OS strategies are testable on any host — CI runs the suite on Linux only, so without them the Windows branch would ship unexercised.
