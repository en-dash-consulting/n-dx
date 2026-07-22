---
"rex": patch
"@n-dx/hench": patch
---

fix(hench): make parent auto-completion self-healing so cascades are no longer silently lost (#293)

During `hench run --auto --loop`, a child task could be persisted as `completed` while the parent auto-completion cascade was silently dropped — leaving parent features stuck `pending` with every child done, and no reconciliation path to recover. The cause: in `toolRexUpdateStatus` the `status_updated` log append and the cascade shared the caller's single best-effort `try/catch`, so a log-append failure after the child's status write cancelled the cascade; and the cascade was event-driven (`findAutoCompletions` walks only the triggering item's ancestor chain), so a missed cascade was never retried.

Two changes:

- **rex:** add `reconcileAutoCompletions(items)` — a whole-tree, bottom-up sweep that completes every parent whose children are all terminal (`completed`/`deferred`), independent of any single trigger item. It self-heals parents whose earlier cascade was lost. Exported from `public.ts`.
- **hench:** in `toolRexUpdateStatus`, wrap the `status_updated` append in its own try/catch so a log failure can no longer cancel the cascade, and drive the cascade with `reconcileAutoCompletions` (via `rex-gateway`) for whole-tree healing. Cascade failures in `updateCompletedTaskStatus` and the finalize path are now recorded in `run.diagnostics.notes` instead of a console-only warning.
