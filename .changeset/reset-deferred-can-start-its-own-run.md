---
"@n-dx/hench": patch
---

`--reset-deferred` can now start the run it enables, and a refused run exits non-zero (#365)

`ndx work --auto --loop --reset-deferred` on a clean tree reset deferred/failing
tasks to pending — which writes `.rex/prd_tree/` — and the pre-run commit gate
then refused to start because the tree was dirty with the files the reset
itself had just produced. Exit code was 0, so the refusal read as success in
an unattended context and the tasks stayed deferred forever.

The reset now commits its own PRD-tree write immediately
(`commitResetDeferredChanges`), the same pattern already used to commit a
task's completion write on the autoCommit path. The pre-run gate therefore
only ever sees a genuinely dirty tree — the user's own uncommitted work —
which still refuses exactly as before.

Also fixed: the gate's refusal path returned without setting a nonzero exit
code, so a real refusal (dirty tree, no `--reset-deferred` involved) also
reported success. `process.exitCode` is now set to `1` whenever the gate
declines to start the run.
