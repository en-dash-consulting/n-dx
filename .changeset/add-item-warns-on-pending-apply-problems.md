---
"@n-dx/rex": patch
---

`add_item` (v2 change with `amends`) and `place_change` (relation `amends`) refuse only what `apply_change` would always refuse. A problem that only another open change causes, such as removing a node another open change still amends (`open-change-refs-live`) or whose live descendants another open change removes, no longer refuses: the change is stored and the response carries an additive `warnings` list naming the open change(s) and apply's message. `apply_change` is unchanged and still refuses until that change is applied or closed.
