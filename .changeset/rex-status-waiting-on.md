---
"@n-dx/rex": patch
---

`ndx status` and `rex tree` show `(waiting on: <titles>)` on a pending or in-progress item whose `blockedBy` items are not completed, and list siblings after the ones they wait on.

Previously a dependency showed only on items marked `blocked`, so a waiting item read as ready, and siblings kept their stored, usually alphabetical, order. The marker disappears once every blocker is completed. Ordering is stable: unrelated siblings and siblings in a dependency cycle keep their stored order. `ndx status --format=json` adds an optional `waitingOn` list of open blocker ids to each waiting item; existing fields are unchanged.
