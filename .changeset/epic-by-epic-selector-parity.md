---
"@n-dx/hench": patch
---

Fix `--epic-by-epic` walking every epic and running no tasks.

The run printed each epic's header and `Starting: N actionable task(s)`, found
nothing to select, recorded the epic `no_actionable_tasks`, and moved on. Every
epic in turn, then a summary — so the whole invocation looked like it had only
validated the PRD.

Two different readings of "actionable" were in play. `getEpicScopeInfo` counted
each task's own status, while the selector prunes an entire subtree the moment
an ancestor is blocked, cancelled, deleted, or waiting on an unfinished
`blockedBy`. An epic in any of those states is full of `pending` tasks that can
never be selected — the announcement came from the status count, the work came
from the selector, and they disagreed. A PRD whose epics carry dependencies on
each other (the natural shape for working epic by epic) hit this on every epic
after the first.

The actionable count now comes from the selector itself — the same
intersection the autonomous path computes — so the number announced before an
epic starts is the number the loop will find. `--epic` has the same guard and
is fixed with it.

Two visible consequences:

- An epic that cannot be worked now says why: `Epic "Payments" is waiting on
  epic-0, so none of its 3 remaining task(s) can be selected`, or names the
  epic's own status and the `rex update` that clears it. Previously it said
  there were no actionable tasks in an epic whose every task reads `pending`
  in `rex status`, with nothing naming the thing in the way.
- A pending parent with outstanding children no longer counts as actionable
  alongside those children. The selector only offers a parent once its
  children have succeeded, so counting both reported two tasks where the loop
  could pick up one.

The progress counters (`totalTasks`, `completedTasks`, `isComplete`) are
unchanged — they describe the epic's contents, and only "actionable" was ever
the disputed number.
