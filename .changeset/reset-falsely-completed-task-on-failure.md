---
"@n-dx/hench": patch
---

A failed run no longer leaves the PRD claiming the task succeeded.

`resetInProgressTaskIfFailed` returned early unless the task was still
`in_progress`. But the spawned agent can mark the task `completed` itself,
mid-run, before any of hench's gates have run — run 60c3a951 shows the executor
doing exactly that around turn 48. If the run then ended in any failure status,
the guard saw `completed` rather than `in_progress`, skipped the reset, and the
PRD permanently recorded a failed task as done. `get_next_task` would never
offer it again, so the work silently disappeared.

The reset now covers `completed` as well as `in_progress`. Deliberate parking
statuses are still left untouched: `blocked` and `deferred` are what the
executor prompt tells the agent to set for an external dependency or a
postponement, and `failing`/`cancelled` come from specific failure handlers.

Resurrecting genuinely finished work is not a risk, because
`transitionToInProgress` runs before the spawn — any `completed` seen at
finalize time was written during this run. When the reset overrides a
completion claim, the run says so instead of correcting it silently.
