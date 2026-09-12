---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

Completion no longer cascades over an in_progress parent or outside the run's subtree (#368)

A run that hit the account session limit on turn 1 — status failed, 1 turn,
zero tool calls, no changes; the agent never ran — nonetheless closed a task
and an epic belonging to another user, in an epic it had never touched, and
rewrote `lastModifiedBy` on both to whoever was running the command. The task
was an open investigation with unmet acceptance criteria whose single subtask
happened to be completed. It was caught only because the run left the tree
dirty and someone read the diff.

Three independent things had to be true for that to happen, and all three are
now fixed:

- **An `in_progress` parent is no longer auto-completed by a child
  transition.** `AUTO_COMPLETABLE_STATUSES` is `{pending}`;
  `in_progress` is a deliberate claim that the parent has work of its own.
  `remove-task.ts` now imports that set rather than keeping a second copy.
  `rex status`'s auto-completable *hint* still lists `in_progress` parents, so
  one that really has finished is surfaced for a human to confirm.
- **A cascade cannot leave the subtree the run is operating on.**
  `reconcileAutoCompletions` takes `{ ancestorsOf }`, which confines its
  whole-tree self-healing sweep to that item's ancestor chain; an unrecognised
  id contains it to nothing rather than degrading to a full sweep. Hench's
  `rex_update_status` passes the task it was asked to update.
- **A cascade no longer rewrites authorship.** New
  `WriteOptions.preserveModifiedBy` keeps an item's existing `lastModifiedBy`
  while still stamping `lastModified`; every cascade write site (hench's tool,
  `rex update`, the `update_task_status` MCP tool, `rex remove`) sets it. Both
  local stores and all four remote adapters honour it, and it survives the
  transaction-level stamp in `stampChangedItems`.

This is distinct from #364, which narrowed which *child* statuses count as
done. Here the child genuinely is completed, so that predicate was satisfied
and the cascade still fired. Both guards are needed; the module header of
`core/parent-completion.ts` records why they must not be merged.

Also declares `lastModified` / `lastModifiedBy` on `PRDItem`. Both were
already written by every store adapter but reached readers as `unknown`
through the index signature.
