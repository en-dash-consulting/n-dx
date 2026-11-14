---
"@n-dx/hench": patch
---

A test run killed inside hench's Linux sandbox no longer leaves later sandboxed test runs waiting on the validation slot until they time out.

Under bubblewrap each confined command gets its own PID namespace, and a confined runner cannot tell whether a holder in another sandbox is still alive. Hench runs on the host, where it can, so it now clears a stale holder record before each confined spawn (`run_command`, `git`, the vendor CLI) and before each of its own validation commands. This runs whether or not `hench.testGate.hostSlot` is on, never waits, and never stops the spawn.
