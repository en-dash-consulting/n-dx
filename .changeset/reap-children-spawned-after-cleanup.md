---
"@n-dx/core": patch
---

Reap child processes spawned after the cleanup gate has already run.

`createChildProcessTracker`'s `cleanup()` terminated the children it knew about
at the moment it was called, then the process exited. But terminating the
in-flight child is precisely what unblocks whatever was awaiting it — so the
caller promptly spawned the next one, and that child was adopted into a set
nobody would drain again.

`ndx ci` leaked one orphan per Ctrl-C this way: the gate SIGKILLed `sourcevision
analyze`, `runCapture` resolved, `runCI` advanced to `sourcevision validate`, and
the parent exited leaving that child reparented to PID 1. A sweep of one dev
machine found 31 of them across seven worktrees, holding 431 MB, the oldest alive
for over 11 hours — enough to push hench's memory monitor toward throttling later
autonomous runs.

`register()` now refuses to adopt a child once cleanup has started and SIGKILLs
it instead — synchronously, and without the SIGTERM grace period, because the
grace period is exactly the window in which the parent exits first. This was a
production defect, not only a test-side leak; the test fix is the backstop.
