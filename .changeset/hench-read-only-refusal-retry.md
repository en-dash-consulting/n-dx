---
"@n-dx/hench": patch
---

A forked task attempt that ends with no changes and no file-edit tool calls is now reported as a read-only refusal ("Agent treated the forked session as read-only (no edits made)") and re-spawned once in the same run with a cold spawn, without using retry budget. The session cache is kept. The run record names it (`readOnlyRefusal`, spawn reason `read-only-retry`) and `hench show` prints it. If the cold retry also changes nothing, the run fails with the usual no-changes reason (#473).
