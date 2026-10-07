---
"@n-dx/web": patch
---

`PUT /api/hench/prep/:taskId` saves a task's own run settings.

The dashboard can now write the `run` block `ndx work` has read since PR 3. Body is `{run, version}`; `null` or `{}` clears the block, and the write happens inside `store.withTransaction` against the workspace the request addressed, so it takes that worktree's PRD lock and rewrites that worktree's tree alone.

**Concurrency.** `version` is a short fingerprint of the saved block — `"none"` for a task carrying nothing — reported by `GET /api/hench/prep/:taskId` as `savedVersion` and checked inside the transaction. A save made against a stale read answers 409 carrying the current block and version, so the client can show what it would overwrite and offer to do it (resending with that version is the overwrite). The fingerprint is deliberately not the item's `lastModified`: renaming a task would otherwise invalidate a run-settings version the renamer never touched, and every open modal would report a conflict that is not one. Two blocks differing only in key order share a version.

**Refusals.** A launch-time key (`fresh`, `allowDirty`, `resetDeferred`) is a 400 naming it — those are chosen per launch and saving one would decide for a run nobody has started. Unknown keys, wrong types and out-of-range values go through rex's own `validateRunSettings`, so what the dashboard accepts cannot drift from what the store and `ndx work` accept. A model or provider the active vendor cannot serve is refused before it is saved; a pin for a *different* vendor is allowed through, because a saved block is vendor-agnostic by design. Containers cannot carry run settings (400), a missing task is 404, a workspace with no PRD is 404, and a foreign-site PUT is refused before anything is written.

`GET /api/hench/ready` rows gain `saved: boolean`, so the list can mark a task that will not run on the project defaults.
