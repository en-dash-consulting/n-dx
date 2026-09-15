---
"@n-dx/rex": patch
---

`rex fix` now reopens parents to `pending` and can heal stuck parents.

Two follow-ups from the PR #370 review:

- **Reopen to `pending`, not `in_progress`.** Since #368 made `in_progress` an explicit claim that auto-completion refuses to touch, a parent the repair tool reopened to `in_progress` could never close again when its last child finished. `rex fix` now uses the codebase's reopen convention, matching `cascadeParentReset`.
- **`fix/` shares the real child predicate.** It kept a private terminal-status set that still counted `deferred` as done, so `rex validate` warned about a completed parent with a deferred child while `rex fix` proposed nothing for it. Both now read `SUCCESSFUL_CHILD_STATUSES`, so fix repairs exactly what validate warns about.
- **New `stuck_parent` fix kind.** A `pending` parent whose children are all `completed` is now completed (with `completedAt`), bottom-up. This is the operator-facing path to the whole-tree reconciliation that agent runs stopped performing when #368 scoped every run-path sweep to the run's own ancestors.
