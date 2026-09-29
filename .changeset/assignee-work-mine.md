---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

Add an optional `assignee` field to PRD items and `ndx work --mine`.

`PRDItem.assignee` is an optional identity string, in the same "Name
<email>" form `resolveActor` (git `user.name` + `user.email`, falling back
to the OS username) resolves for `lastModifiedBy`. It round-trips through
the folder tree via the existing passthrough-field path and is omitted
entirely when unset — a tree with no `assignee` fields selects tasks
exactly as it always has.

`findNextTask` / `findActionableTasks` gained an `assignee` filter option
(exact match, unset by default) alongside the existing `tags` filter.
`hench run --mine` (and `ndx work --mine`) resolves the current user the
same way rex stamps `lastModifiedBy`, and restricts autoselection to tasks
assigned to that identity. Like `--tags`, an explicit `--task` bypasses the
filter, and it is not supported together with `--epic-by-epic`.

`resolveActor` is now re-exported through hench's `rex-gateway.ts` so hench
resolves the current user the same way rex does, rather than keeping a
second, driftable definition of "who is running this" (the gateway's export
cap moves from 42 to 43 accordingly).
