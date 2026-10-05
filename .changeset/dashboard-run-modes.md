---
"@n-dx/web": patch
---

Start a loop or a fixed number of tasks from the dashboard, not just one.

The dashboard's only run control started exactly one task. `hench run` has had
`--iterations=<n>` and `--loop` since long before the dashboard existed, so the
only way to leave an agent working through the queue was to abandon the
dashboard and go to a terminal — on the very screen that shows what the queue
contains.

`POST /api/hench/execute` now accepts `mode`:

- `single` — one task. The default, and what a request naming no mode has
  always produced, so existing clients are unaffected.
- `iterations` — plus an `iterations` count, becomes `--iterations=<n>`.
- `loop` — becomes `--loop`: task after task until nothing is actionable.

`--task` still names where to start in every mode; hench autoselects by
priority for each task after the first, so a loop begins exactly where the
operator clicked. `--reset-deferred` is unaffected and still applied when the
starting task is deferred.

The count is bounded at 25. Not a CLI limit — `hench run` takes any number —
but a limit on what one unattended click may commit to, since the spawned
process outlives the tab that started it. Past that, `loop` is the honest
choice: it stops when the queue is empty rather than when a number runs out.

In the viewer, Start Task carries a mode picker at the three "start the next
actionable task" entry points (the Rex Dashboard's Up Next card, the Hench Runs
empty state, and the Live view). It is opt-in: the Workspaces board renders one
button per worktree row, where the question is which worktree to start rather
than how much work the click commits to.

The chosen mode is named on the button itself ("Start working · until done",
"· 5 tasks") and resets to a single task once a run starts — a picker that only
changed hidden behaviour, or one that stayed on "until done", is how someone
launches a queue-long run believing they started one task.
