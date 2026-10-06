---
"@n-dx/hench": patch
---

Commit the PRD completion record on every path, not just `autoCommit`.

A finished task left `prd_tree/` dirty, and the next autonomous run's pre-run
gate then refused to start — over a write hench had made itself. The task was
done and the queue was stuck behind it.

`updateCompletedTaskStatus` writes the task to `completed` just before the
commit step, so the tree is always dirty at that moment. Two things can land
it: the commit prompt sweeps the PRD paths into the run's own commit, or
`commitCompletionMetadata` makes a small second commit. The second was gated
on `autoCommit`, and the first bows out before it reaches `git commit`
whenever the executor already committed for itself — no `.hench-commit-msg.txt`,
an empty one, an empty index, or the commit-message watcher having fired
first.

All four are ordinary endings for a task where the agent commits as it goes,
which is most UI work. On any of them nothing owned the completion write.

The record commit now runs whenever the run completed, regardless of path. It
is a no-op when the prompt already carried the PRD paths, so there is no
duplicate commit — with one deliberate exception: the commit-attribution write
(which records the commit's sha back onto the PRD item) happens *after* that
commit, and this is what finally lands it. That write was dirtying the tree
after every prompt-path run too.

A human who declines at the commit prompt is the one case left alone: their
tree is theirs from that point, and landing PRD state they just refused to
commit would take the decision back off them.

One visible consequence: `HEAD` after a completed run is now the
`chore(prd): …` record commit rather than the work commit, on the paths that
previously made no second commit. This already was the shape on the
`autoCommit` path.
