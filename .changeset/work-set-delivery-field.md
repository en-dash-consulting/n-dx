---
"@n-dx/rex": patch
---

The v2 state row takes an optional `delivery: { branch }`: the branch whose work set holds a task, or a change with no tasks. It is additive, so existing trees load unchanged; an empty or non-string branch fails validation. New core functions in `core/work-set.ts` assign units to a branch (a change assigns its open tasks; a unit on another branch is refused unless `move` is passed), unassign them, and read a branch's work set.
