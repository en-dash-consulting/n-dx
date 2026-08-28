---
"@n-dx/hench": patch
---

Commit adversarial-review repairs on the autoCommit path instead of orphaning
them in the working tree.

On `--yes`/auto runs the executor commits its own work before the review pass
runs, the reviewer is barred from committing, and the completion-metadata
commit stages only `.rex/prd_tree` — so a must-fix repair the reviewer applied
in-session was owned by nobody and got swept into whatever commit happened
next (observed end-to-end in the review-pass verification).

The reviewer spawn is now bracketed by working-tree snapshots (dirty paths →
content hash), and the diff — exactly what the reviewer changed, never
pre-existing dirt — is recorded on the run as `review.repairedFiles` and
committed on the autoCommit path as a dedicated pathspec commit referencing
the run and task (`review.repairCommit`). Interactive runs are unchanged: the
commit prompt already sweeps repairs into the task's commit. A repair commit
that cannot be made is reported with the leftover paths, never thrown — an
uncommitted repair is an inspection burden, not a broken task.
