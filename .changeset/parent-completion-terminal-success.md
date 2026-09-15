---
"@n-dx/rex": patch
---

Do not auto-complete an epic that still has deferred, blocked, or failing children (#364)

Auto-completion treated `deferred` as terminal alongside `completed`, so an
epic with a deferred child could be reported done while the work was not.
That happened live: an epic was marked completed with three of five children
in `deferred` after a session-limit interruption, while one of the deferred
tasks left a half-finished MCP-registration migration in place — reported as
done.

Auto-completion now treats only `completed` as a successful terminal state.
`deferred`, `blocked`, and `failing` children all block a parent from
auto-completing. The predicate (`SUCCESSFUL_CHILD_STATUSES` /
`allChildrenSuccessful` in `core/parent-completion.ts`) is now the single
source of truth, reused by `findAutoCompletions`, `reconcileAutoCompletions`,
`removeTask`'s post-removal auto-completion check, the `rex status`
auto-completable section, and the structural health check that flags a
completed parent with non-terminal children.

Also closed a related gap: `findAutoCompletions` unconditionally treated its
triggering item as done, even when that item's own new status was `deferred`
rather than `completed` — reintroducing the same bug through a different
path. It now only seeds the cascade when the triggering item actually
completed successfully.
