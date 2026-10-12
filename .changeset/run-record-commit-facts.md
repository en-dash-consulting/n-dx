---
"@n-dx/hench": patch
"@n-dx/rex": patch
---

Run records keep each commit's author date, and `hench show <run> --repoint`
finds where a run's commits went after a rebase.

A run record names commits — `startHead`, everything the run committed, and
the reviewer's `repairCommit` — and a stack rebase or squash merge rewrites
all of them at once. On 2026-10-07 every commit cited in the PR 27/8 and
#548/#549 run records stopped being on main, and the record had nothing left
to find them by.

Each commit a run produces now stores its author date beside its SHA and
subject, and the baseline gets the same treatment in a new `startHeadCommit`.
A rebase preserves author email, author date and subject, so those three are
what identify the twin.

`hench show <run-id> --repoint` reports what moved, what was already on the
ref, and what could not be matched and why; `--write` applies it. The matching
rules come from rex's `repointCommits`, now part of its public API — a
hench-local copy would be a second definition of commit identity across a
rewrite, free to disagree with rex's about the same pair of SHAs. An
unmatched SHA is always reported and never dropped from the record.

Records written before this change are still readable, and still re-point: the
rules read the old SHA's facts from git, so the stored copy is an aid rather
than a requirement.
