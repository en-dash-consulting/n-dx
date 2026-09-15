---
"@n-dx/hench": patch
---

Refuse to mark a task completed while its work is uncommitted (#363)

A run could finish with the agent's files still in the working tree while the
only commit to land was hench's own `chore(prd): commit PRD tree changes (task
<id> completed)` — the code sat uncommitted and the PRD recorded the opposite
of the truth. In a `--loop` run it compounded: the next task started on a tree
still holding the previous task's output, and the two tangled together.

`finalizeRun` now checks the working tree before the completion status is
written. Paths a later step of the same run still commits are discounted — the
PRD folder tree, the review repairs on the autoCommit path, and the staged
index wherever the commit prompt follows — as are hench's own runtime
artifacts, matching the pre-run gate's existing discount. Anything left is
finished work with no owner: the run fails, names every path, and the task is
reset to pending (including when the agent had already written `completed`
itself). Nothing is discarded, and the failure suppresses the rollback prompt
so the refused work cannot be reverted by the next keystroke.

Autonomous multi-task runs now re-check the tree between tasks and stop rather
than starting a task on top of the previous one's output.
