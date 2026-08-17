---
"@n-dx/core": patch
---

Fix a POSIX process-group leak where surviving grandchildren were never force-killed.

`terminateProcessGroup` sent SIGTERM to the child's process group, then decided whether to escalate to SIGKILL by checking the **direct child**:

```js
await Promise.race([waitForChildExit(child), delay(forceKillTimeoutMs)]);
if (!isChildRunning(child)) return;            // gates on the child
try { killGroup(-child.pid, "SIGKILL"); }      // escalation for the group
```

The leader commonly installs a SIGTERM handler and exits promptly while a grandchild ignores the signal — routine for long-running CLIs, including the claude/codex processes `ndx` spawns. The child's exit resolved the wait, the early return fired, and SIGKILL never reached the group, stranding every surviving member. That is the precise leak process groups exist to prevent.

Escalation now depends on the group: `groupHasMembers()` probes with signal 0 (a kernel existence check that delivers nothing) and `waitForGroupExit()` polls it on a bounded deadline instead of awaiting the child's `exit` event, so all members get the grace period and SIGKILL lands whenever anyone is left.

This is POSIX signal semantics, so it affected **macOS as well as Linux**.

PID-reuse safety is documented at the probe: a pgid stays allocated while its group has members, and a pgid is its leader's PID, so that PID cannot be recycled while anyone remains in the group — probing immediately before signalling cannot target an unrelated process. If the group drains in between, the signal fails ESRCH and is swallowed.

The Windows `taskkill /T /F` path is unchanged.
