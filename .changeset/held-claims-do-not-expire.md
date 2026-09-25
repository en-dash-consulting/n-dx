---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

A held claim no longer expires — it ends only when someone deals with the work

A claim held with reason `uncommitted-work` used to lapse at whatever lease
expiry it had when the completion gate refused — four hours by default — so
overnight the hold quietly evaporated and another worktree could pick the
task up and redo work that was still sitting uncommitted. Meanwhile the
refusal message promised the task was "held until someone deals with that
work".

The message is now true. A held claim survives its lease: it is freed only by
`ndx claim release <id>` (the work was dealt with), `release --force`, or a
fresh claim from the worktree that left the work (a re-run there clears the
hold). `ndx claim list` shows `expires: never — held until released` for a
held claim instead of a lease time that no longer applies, and the refusal
another worktree sees says the hold does not expire. Ordinary claims keep
their existing lease-and-pid liveness exactly as before.
