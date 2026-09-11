---
"@n-dx/hench": patch
---

fix(hench): stop counting `.rex/`/`.hench/` bookkeeping as the run's changed files

`discoverChangedFiles` decides whether the full-suite test gate runs at all: an
empty set skips it. But the set was built from `git diff` against the pre-run
commit with no path filtering, and hench dirties `.rex/prd_tree/<task>/index.md`
on every run the moment it marks the task in-progress. Every run therefore
"changed files" — even one whose agent produced no code at all — so the gate ran
the full workspace suite, and any pre-existing failure anywhere in the repo
failed the run, reset the task to pending, and offered to revert the operator's
own uncommitted PRD edits.

`.rex/` and `.hench/` paths are now excluded from the discovered set, in both
the diff-derived and untracked halves. They are never the run's work product:
the agent's own prompt forbids touching them, the completion-metadata commit
stages `.rex/prd_tree` through its own dedicated path, and the reviewer's
repaired-files set already filtered them the same way. A run that changed only
bookkeeping now skips the gate with "No files modified in prior phases", and a
run with real changes is tested exactly as before.
