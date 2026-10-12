---
"@n-dx/web": patch
---

The dashboard reads a node's **type**, not v1's `level`. Schema v2 replaced
`level` (epic/feature/task/subtask) with `type` (area/capability/constraint/
change/task/subtask), and both storages are live, so the two vocabularies had
to coexist somewhere rather than everywhere.

`src/shared/item-type.ts` is now the one module in the package that reads a v1
`level` — `itemTypeOf(item)` prefers `type` and falls back to `level` — and the
one that writes one, through `levelOf(type, parentType)`. Every route, view,
component and hook keys on `ItemType` instead. The vocabulary is the union of
both versions on purpose: a v1 item reads as its own level and a v2 node as its
own type, because collapsing epic and feature onto `change` at read time would
relabel every epic in a v1 PRD, and that collapse belongs to the migration.

`POST /api/rex/items` accepts `type`, infers it from the parent when it is
absent, and still accepts `level` as the v1 spelling. It refuses a
product-layer type with the reason — the store behind it is v1 and has no level
to write one as — rather than silently filing it as an epic. The add, delete,
prune, requirements, validation, search, live and merge-graph payloads carry
`itemType` where they carried `level`; the add and delete responses still carry
`level` alongside it.

Net removals rather than additions: the viewer's own level hierarchy
(`prd-tree/levels.ts`), six copies of a level-label map, two emoji tables and
three parent/child tables are gone. The local hierarchy had already drifted —
it said a subtask holds nothing, where rex says it holds a subtask — and
`tests/unit/shared/item-type-contract.test.ts` now pins the mirror against
rex's own tables so it cannot drift again. With the level system no longer
reached from routes, `isItemLevel`, `isRootLevel`, `isWorkItem`,
`LEVEL_HIERARCHY` and `CHILD_LEVEL` leave the web→rex gateway.

A capability's criteria are labelled "Capability criteria" and a work item's
acceptance criteria "Done when", per the 2026-10-08 terminology decision.
