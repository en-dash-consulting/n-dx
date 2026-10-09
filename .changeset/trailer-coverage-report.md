---
"@n-dx/rex": patch
"@n-dx/core": patch
---

Turn `rex backfill-commit-attribution` into a read-only trailer coverage report.

Schema v2 stores no `commits` on an item — a commit's SHA is not its identity, so a change's commits are computed from its `N-DX-Item` trailers on demand. That left the backfill writing state nothing reads. What survives is the question it was really answering: how much of history can be attributed at all, which is worth knowing before the trailer format is frozen.

The command now reports, for every commit reachable from the default branch, whether its message carries an `N-DX-Item` or `N-DX-Status` trailer — grouped by author and by month, with totals. `--json` (or `--format=json`) prints the same report machine-readably, and `--ref=<branch>` reads another branch.

It writes nothing: not under the rex directory, not the trailer cache `change-commits.ts` keeps, and it no longer loads the PRD at all.

Two counts are reported rather than one, because they disagree and the gap matters. `covered` scans the whole message; `attributed` asks git's own trailer parser, which is what attribution actually reads — and git reads trailers only from a message's final paragraph. On this repository 67 of the 79 covered commits write the trailer outside it, so a single number would either call history covered that nothing can attribute, or hide that the trailer was written at all. Merge commits are counted separately for the same reason: they carry no trailer by construction.

A git failure — an unknown ref, a shallow CI checkout — now fails the command with the cause named. The predecessor caught it and returned normally, which reported an unreadable log as success.
