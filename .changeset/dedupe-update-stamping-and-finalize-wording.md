---
"@n-dx/rex": patch
---

Share the update-stamping rule across the six store adapters, and stop `rex next`
calling a deferred child "completed".

Every `updateItem` implementation carried a pasted copy of the same three lines:
merge `updates` onto the existing item, then stamp it, choosing the author with
a `options?.preserveModifiedBy ? existing.lastModifiedBy : undefined` ternary.
Six copies — the folder-tree store, the Asana, Jira, GitHub Projects and Notion
adapters, and a partial-update variant in the file adapter, which had already
diverged. `stampUpdatedItem` and `stampUpdatedFields` in `core/sync.ts` now hold
it once, over a single private `updateActor` rule, so the `preserveModifiedBy`
behaviour (#368) can be corrected in one place.

`explainSelection` announced "all children completed, ready to finalize" off an
inline `completed || deferred` check. That is the #364 misreport exactly: #364
narrowed `SUCCESSFUL_CHILD_STATUSES` to `{completed}` precisely so a deferred
child would stop counting as done, and this copy was missed. It now calls
`allChildrenSuccessful`, so a parent with a deferred child is described at its
priority rather than as ready to finalize.

No behaviour change beyond that one summary line.
