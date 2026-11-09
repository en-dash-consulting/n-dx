---
"@n-dx/web": patch
"@n-dx/rex": patch
---

The dashboard server reads and edits the current branch's work set: `GET /api/rex/work-set` groups its open units by change and marks those that inherit their branch, and `POST /api/rex/work-set/add` and `/remove` write through rex's `assign_to_branch` handler, refusing on the default branch, a detached HEAD, a task on another branch and while a run is live. Ready to run, Live's next queue and the Plan glance's next pick are narrowed to the work set on a branch that has one, as `ndx work` narrows its pick. Rex exports `handleAssignToBranch`.
