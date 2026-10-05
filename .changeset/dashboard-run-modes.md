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

In the viewer, the mode picker sits at the three "start the next actionable
task" entry points (the Rex Dashboard's Up Next card, the Hench Runs empty
state, and the Live view). It is opt-in: the Workspaces board renders one
button per worktree row, where the question is which worktree to start rather
than how much work the click commits to.

The picker qualifies **Start now**, the split button's one-click run, and the
chosen mode is named on that menu item ("Start now · until done", "· 5 tasks").
It deliberately does not touch the Prepare task modal the primary click opens:
the modal configures one run of one task in detail and prints the command line
for it, so a mode on its label would describe a run it does not start. The mode
resets to a single task once a run starts — a picker that only changed hidden
behaviour, or one that stayed on "until done", is how someone launches a
queue-long run believing they started one task.

One validator judges the mode everywhere it is read — the execute route, the
`execute/check` the hub asks before queuing, and the hub proxy. A mode is
validated in `judgeExecuteRequest`, the function both server routes share, so
`execute/check` answers for it too; without that the hub could admit a request
only the spawn would refuse. A present-but-unrecognised mode is an error rather
than a fall back to `single`: the proxy used to keep only the modes it
recognised and drop the rest, so a saturated hub queued `{ mode: "looop" }` as
a single-task run and started it a minute later, where the direct route
answered 400 — the same request judged two ways depending on how busy the
machine was.

The mode travels with the request through the hub's queue. A queued entry is
replayed from what the hub stored, not from the original body, so a mode that
stopped at the queue would start one task under a 202 that said "until done";
`QueueEntry` therefore carries it alongside the run options, and the hub's 202
echoes it — including through the duplicate-entry replacement, which rebuilds
the entry field by field, so a re-ask that changed the mode drained with the
old one. The flags themselves are emitted by `workCommandArgs`, the one
builder the server spawns from and the modal prints from, rather than being
appended at the spawn site. `RunMode` and the iteration bounds moved to
`src/shared/run-options.ts` for the same reason: the server, the hub and the
viewer all read them, and three copies are three things free to drift.
