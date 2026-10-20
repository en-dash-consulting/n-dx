---
"@n-dx/hench": patch
"@n-dx/rex": patch
---

`ndx work` now completes a parent whose children are all completed, and commits the completed status. rex offers such a parent as the next task, but its work landed with its children, so a run on it changes no code. The completion gate refused every one of those runs ("No changes detected in git diff") and put the parent back to pending. The next run picked it again, and each refused run left its status writes uncommitted in `.rex/prd_tree/`. The gate now accepts an empty diff for a finalize-ready parent, using rex's own `allChildrenSuccessful` (now exported), and the completion commit carries it.

The commit that lands a completed status now always has an `N-DX-Status: <id> in_progress → completed` trailer. On the commit-prompt path it never did: hench writes `completed` before the prompt runs, so the prompt read the item as already completed and left the trailer off. The completion-record commit had no status trailer at all.
