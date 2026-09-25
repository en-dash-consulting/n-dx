---
"@n-dx/hench": patch
---

A completed task stays completed when only its PRD record commit fails

When a run's work had landed and validated but the follow-up completion
metadata ("record") commit was rejected — a hook, a lock, a signing failure —
hench marked the run failed and withdrew the completion, resetting the task
to pending. The withdrawal responded to "I cannot commit PRD state" by
writing more PRD state through the very path that just failed, leaving the
tree dirtier than the failure did, and handing a genuinely finished task to
the next run to redo.

Now the run and the task both stay completed. Nothing is withdrawn, the
cross-worktree claim lapses through the run's normal release, and the run
record carries `recordCommitPending: { paths, error }` — the exact
project-relative paths the record commit tried to stage. The CLI prints
"Work committed; record not committed" with `git add`/`git commit` commands
scoped to those paths, so landing the record by hand cannot sweep anything
else. A genuine
task failure fails the run exactly as before.
