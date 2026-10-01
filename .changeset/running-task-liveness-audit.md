---
"@n-dx/web": patch
---

Audit which "running" tasks are actually running, and end the ones that aren't from the active-task list.

A run file says `status: "running"` until the process that owns it writes a terminal status. A crash, a Ctrl-C or a reboot never gets that far, so the file says "running" for good and the dashboard's Active Tasks panel fills with runs nothing is executing — twelve of them in this repo, the oldest idle for a month. Elapsed time could not tell these apart from a genuinely long run, so the existing `stale` flag only ever expressed a suspicion, and there was no way to clear a run from that list.

`server/run-liveness.ts` now answers the question from evidence: a run is `live` when the dashboard owns its child process or a live `.hench/locks/<pid>.lock` names its task, `foreign` when another host recorded it (local PIDs say nothing about it), `unknown` when live hench processes exist but none can be attributed to it, and `orphaned` when nothing on this host could be running it. Untagged locks — `hench run --auto` records no task id — are attributed by start time, so one process started today no longer makes every abandoned run unjudgeable.

- `GET /api/hench/audit` and `GET /api/hench/runs/health` carry `liveness`, `livenessReason` and `canEnd` per run plus a summary; `stale` is unchanged and still reported, since the two disagree in both directions.
- `POST /api/hench/runs/reconcile` ends every run no process is executing. It signals nothing — it only rewrites files whose owner is already gone — and skips `live` and `foreign` runs entirely. `dryRun` reports without writing, `includeUnknown` widens to unattributable runs, `runIds` restricts the sweep.
- The Active Tasks panel shows the verdict and its justification on each card, an End button per card, and a banner offering to end all the dead ones at once. Anything not proved dead asks for confirmation first.
