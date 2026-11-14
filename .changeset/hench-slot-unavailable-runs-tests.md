---
"@n-dx/hench": patch
---

With `hench.testGate.hostSlot` on, a validation slot that cannot be taken no longer lets a run finish without running its tests.

If the slot directory cannot be written (no permission, a read-only or full disk, a filesystem without hard links), the test gate, its re-run, the post-task tests and the completion check now run their command without the slot and report its real result. A warning says the slot was skipped, why, and names the slot directory. Before, the gate was reported as not run and the task was completed and committed untested. Interrupting a wait (Ctrl-C, SIGTERM) still stops without running the tests.
