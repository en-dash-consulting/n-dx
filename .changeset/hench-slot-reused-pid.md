---
"@n-dx/hench": patch
---

With `hench.testGate.hostSlot` on, a restarted hench no longer waits forever on a slot record left under its own process id, and the wait message names the record to delete.

When hench dies without giving the slot back, the operating system can give its process id to another process. Windows does this within moments. A hench process now treats a `holder.json` or `reclaim.lock` that names its own process id, but a token it does not hold, as left by a dead process and reclaims it at once, unless the record's test command is still running. Another hench process cannot tell whether that process id has been reused, so it keeps waiting. The wait line now ends with the full `holder.json` path: confirm no ndx test run is active, then delete that file. Only an interrupt (Ctrl-C, SIGTERM) stops a wait; there is no maximum wait.
