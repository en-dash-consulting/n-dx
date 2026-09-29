---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

Scope `--mine` to what it acts on, name the identity when it matches nothing,
and inherit blockers in `rex ready`.

`--mine` now matches an item whose own `assignee` *or any ancestor's* carries
the identity. Matching only the item's own field meant handing someone a
feature or an epic selected nothing at all, because the tasks beneath it carry
no field of their own. The rule lives in rex's new `matchesAssignee`, exported
through hench's `rex-gateway.ts` (export cap 43 → 44) so "mine" means the same
thing everywhere it is asked.

The deferred/failing reset offered when a `--mine` menu comes back empty now
counts and resets only that identity's tasks. It previously counted the whole
PRD and, on "y", reset every deferred and failing task in it — other people's
included, committed under the answering operator's name. `ndx work --mine
--reset-deferred` is scoped the same way.

When `--mine` matches nothing, the message names the identity `resolveActor`
produced and says how many actionable tasks exist without the filter; `--loop`
no longer reports "All tasks complete", which described the whole project after
looking at one slice of it.

`rex ready` no longer marks an item whose ancestor is blocked, cancelled,
deleted, or has an open `blockedBy`. It inherited requirements from ancestors
but checked blockers only on the item itself, so a task under a blocked epic
was marked ready although task selection would never offer it. Readiness and
selection now share one predicate (`traversalBlock`), and the evaluation names
the offending ancestor in its `reason` and in a new optional `blockedAncestor`
field.
