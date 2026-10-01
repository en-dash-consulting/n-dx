---
"@n-dx/web": patch
"@n-dx/hench": patch
---

Audit which "running" tasks are actually running — from the dashboard and from the CLI — and end the ones that aren't.

A run file says `status: "running"` until the process that owns it writes a terminal status. A crash, a Ctrl-C or a reboot never gets that far, so the file says "running" for good and the dashboard's Active Tasks panel fills with runs nothing is executing — twelve in this repo, the oldest idle for a month. Elapsed time could not tell these apart from a genuinely long run, so the existing `stale` flag only ever expressed a suspicion, and there was no way to clear a run from that list.

Liveness is now decided from evidence: a run is `live` when the dashboard owns its child process or a live `.hench/locks/<pid>.lock` names its task, `foreign` when another host recorded it (local PIDs say nothing about it), `unknown` when live hench processes exist but none can be attributed to it, and `orphaned` when nothing on this host could be running it. Untagged locks — `hench run --auto` records no task id — are attributed by start time, so one process started today no longer makes every abandoned run unjudgeable.

**CLI** — `hench check-runs` (also `ndx hench check-runs`) audits every run recorded as running and groups them by verdict, each with its justification. `--fix` ends the ones proved dead, signalling no process; `--include-unknown` widens that to unattributable runs; `--strict` exits 1 on anything not confirmed running, for a CI pre-flight; `--format=json` for scripting.

**Dashboard** — `GET /api/hench/audit` and `GET /api/hench/runs/health` carry `liveness`, `livenessReason` and `canEnd` per run plus a summary; `stale` is unchanged and still reported, since the two disagree in both directions. `POST /api/hench/runs/reconcile` ends every run no process is executing, skipping `live` and `foreign` entirely, with `dryRun`, `includeUnknown` and `runIds` to narrow it. The Active Tasks panel shows each verdict and its reason, an End button per card, and a banner to end all the dead ones at once; anything not proved dead confirms first.

The rules live in `hench/src/process/run-liveness.ts` (canonical) and are mirrored in `web/src/server/run-liveness.ts`, because the web package takes no runtime dependency on hench. `tests/e2e/run-liveness-parity.test.js` pins the two to identical verdicts — both surfaces end runs, so a divergence would be a data-loss bug rather than a cosmetic one.
