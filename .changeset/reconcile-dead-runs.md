---
"@n-dx/web": patch
---

Add `POST /api/hench/runs/reconcile`, which ends dead runs in every worktree of the repository. It ends runs whose verdict is `orphaned`, ends `unknown` runs only when `includeUnknown` is set, and never ends `live` or `foreign` runs. `dryRun` reports what would end without writing anything, and `runIds` limits the call to the named runs. Each run is re-checked just before it is written, so a run that has come back to life is left alone. Each worktree's runs are written to that worktree's own `.hench/runs/` with an atomic write, and the response groups the results by worktree. Mark stuck now writes the same terminal shape as reconcile: `status: "failed"`, `finishedAt`, and an error that starts with "Ended by audit reconciliation:".
