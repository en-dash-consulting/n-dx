---
"@n-dx/web": patch
"@n-dx/rex": patch
---

On a v2 project, the dashboard's proposal accept routes (`POST /api/rex/proposals/accept` and `/accept-edited`) now create changes the way `rex analyze --accept` does. Each proposed task becomes an Inbox change that needs placement and keeps its criteria, tags, priority and source. Before, they were written as v1 epics, features and tasks that never reached the Inbox. On both the CLI and the dashboard, an oversized task's proposed subtasks (its LoE decomposition) now become tasks under its change instead of being dropped. A proposal that describes existing code is still not created on v2.

On v2, `accept-edited` also answers with `changeCount` and `taskCount`. The proposal editor now passes each task's `source` and `decomposition` through to that route.

rex now exports `changeInputsFromProposals`, `addProposedChanges` and the `ProposedWork` and `ProposedChangeInput` types.
