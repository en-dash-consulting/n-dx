---
"@n-dx/rex": patch
---

Reject a PRD bundle whose dependency graph cycles or whose nesting is illegal.

`parseBundle` held items to `validateDocument`, which is a field-shape check.
Two whole-tree faults passed straight through it and into the tree:

A `blockedBy` cycle imported cleanly and surfaced later as a wedged
`get_next_task` and `report`, which walk dependencies expecting a DAG. And
nesting was never checked at all, though every other insertion path enforces it
— `insertChild`, `core/move.ts`, with `core/structural.ts` reporting existing
violations. `--replace` installs the bundle's tree wholesale, so a feature at
the root or a subtask under an epic was saved without complaint and reappeared
as a `rex health` / `reorganize` placement violation.

Both are now checked in `parseBundle`, before the store is opened: the rejection
leaves the tree untouched by construction and does not consume a snapshot slot.
The errors name the cycle, or both levels and the offending item's title.

Merge mode gets one further check that `parseBundle` cannot make. Its graft
lands bundle items under *local* parents, and a local reshape may have
re-levelled a same-id item since the export, so placement is validated against
the level of the parent the item actually arrives under — sharing one rule with
the bundle-internal check rather than restating it.

Only cycles are rejected from the dependency graph, not unresolved `blockedBy`
references: a merge legitimately points at ids that live in the destination
tree, and a scoped export already prunes the edges it cannot close. The cycle
detection is now shared with `validateDAG` (`findDependencyCycles`) instead of
duplicated, and `validateDAG`'s own output is unchanged.
