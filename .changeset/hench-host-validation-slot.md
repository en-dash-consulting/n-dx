---
"@n-dx/hench": patch
---

`hench.testGate.hostSlot` makes hench run one managed test execution at a time per OS user on the host, across worktrees, and records queue time apart from run time.

It is off by default, which changes nothing. Set it with `ndx config hench.testGate.hostSlot true .`. The slot covers the test gate and its re-run, the post-task tests and the completion test run; it does not cover an agent's own shell commands, which only `hench.testGate.maxWorkers` bounds. A waiting run prints the holder. Run records and `hench show` gain `queueMs` and `executionMs`. The slot lives under `<ndx home>/validation-slot/`, and a stale holder record is reclaimed automatically.
