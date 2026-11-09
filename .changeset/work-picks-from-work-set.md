---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/rex": patch
---

`ndx work` (`hench run`) picks only from the current branch's work set when it has one: autoselection, the interactive menu, `--loop` and `--plan-queue`. `--any` picks outside it, and an explicit `--task` bypasses it. When the set has nothing left, the run says "Nothing left in this branch's work set; --any picks outside it". `ndx work --resolve` reports the set as `workSet`, with its branch and ids, or `null` when there is none. On the default branch, a detached HEAD or a branch with no assignment, selection is unchanged. rex exports `currentWorkSet`.
