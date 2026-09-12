---
"@n-dx/hench": patch
"@n-dx/rex": patch
---

Calibrate the uncommitted-work guards so autonomous runs stop refusing their own PRD writes.

Three defects, all of which made a run refuse on dirt its own code had just
produced.

**The between-task guard stopped every loop at its first failed task.** It
discounted nothing but hench's runtime artifacts, on the premise that an
uncommitted `.rex/prd_tree/` meant the previous task's status write never
landed. That only holds for a task that *succeeded*: every failure path writes
a `deferred`/`pending` status and commits nothing, because both committers run
only for a completed run and the rollback never reverts unattended. So the
first deferred, failed or timed-out task stopped the loop outright, and the
consecutive-failure counter and stuck-task skipping were unreachable. The
guard now discounts the PRD paths; the completion gate in `finalizeRun` still
covers the case that is real leakage.

**`.rex/tree-meta.json` refused every completion.** Every folder-tree save
rewrites the tracked sidecar, and where the committed copy predates the schema
marker the rewrite changes its bytes. It is not a hench runtime artifact and
not under `.rex/prd_tree/`, so it was discounted by neither gate and staged by
neither committer — the first PRD write of any run left it dirty and the
completion gate refused every task from then on. It is now a PRD commit path
everywhere the tree is, off a single `TREE_META_FILENAME` constant exported by
rex so the staging, discounting and skipping sites cannot drift apart.

**`--epic-by-epic` had no between-task guard at all.** It iterates tasks in its
own loop, which was never wired to the guard, so the work-tangling the guard
exists to prevent still happened there. It now runs the same check before every
task but the first of the invocation, counted across epics.

Also fixes the porcelain reader underneath all three. `git status --porcelain`
output was split with `output.trim()`, which strips the leading space of the
*first* line only — and that space is the blank index column of an unstaged
change. The first entry's path parsed one character short, matching no discount
rule, and its worktree column was read as the index column, so a ` M` file
masqueraded as staged and was discounted outright. Whichever entry git listed
first was the one corrupted, which is why it looked intermittent.
