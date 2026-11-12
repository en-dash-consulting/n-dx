---
"@n-dx/rex": patch
"@n-dx/core": patch
---

Changes, tasks and subtasks take an optional plain-language `summary` that says, for a non-coder, what the work does and why it is worth doing.

`add_item`, `edit_item` (an empty string removes it), `rex add --summary` and `rex update --summary` set it. Analyze proposals ask the model for one, and `/ndx-capture` and `/ndx-plan` draft one with each item.
