---
"@n-dx/hench": patch
---

A completed task now lands as one commit: its work, then its completion. Two
things split them. The agent commits during its session, before hench's gates
mark the task, so the completion followed in a `chore(prd)` record commit. And
where the commit prompt did stage the status with the code, hench then wrote
that commit's SHA onto the PRD item — a write that can only land after the
commit — so every completed run still ended in a trailing `chore(prd)` commit.

The SHA write is gone: a commit is tied to its item by the `N-DX-Item` trailer,
as rex already attributes it. When the agent committed for itself, hench folds
the completion into the run's last commit, adding `N-DX-Status` and, if it was
missing, `N-DX-Item`. The fold only amends a commit this run made that is not
a merge, not on any remote, not for another item, with no git operation in
progress; otherwise the completion gets its own record commit and hench prints
why. A gate-only retry folds into the earlier attempt's work commit.
