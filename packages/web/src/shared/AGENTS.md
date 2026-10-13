# `src/shared/`

The framework-neutral foundation of the web package: both the server and
the viewer import it, and it imports neither.

## `src/shared/` addition policy

`src/shared/` holds framework-neutral modules behind its `index.ts` barrel: data
files, features, view ids and routing, base paths, origin checks, the hub
admission header, and the run-option allow-list in `run-options.ts`. Both server
and viewer import it, so Louvain usually absorbs it into `web-viewer` instead of
emitting a `web-shared` zone — a detection artifact, not a boundary violation.
The rules hold regardless:

- **Framework-agnostic only** — no Preact/React imports, no `node:*`. A utility
  that needs framework APIs belongs in the consuming zone.
- **Barrel imports** — consumers import `shared/index.ts`, never a leaf file.
- **Two-consumer rule** — every module here needs at least two distinct consumer
  zones. Both are asserted by `boundary-check.test.ts`.

## `shared/item-type.ts` is the only reader of v1's `level`

Schema v2 replaced v1's `level` (epic/feature/task/subtask) with `type`
(area/capability/constraint/change/task/subtask), and both storages are live.
`shared/item-type.ts` is the one module that knows this; everything else —
routes, views, components, hooks — calls `itemTypeOf(item)` and keys on
`ItemType`.

- **Never read `item.level` outside that module**, and write one only through
  `levelOf(type, parentType)`, which answers the v1 level a type is stored as,
  and `null` for a product-layer type the v1 store cannot hold.
- **The vocabulary is the union, not the v2 set.** A v1 item reads as its own
  level, a v2 node as its own type. Collapsing epic and feature onto `change` at
  read time — which rex's dual-read loader does for its own purposes — would
  relabel every epic in a v1 PRD; that collapse belongs to `ndx migrate`.
- **The hierarchy tables are a mirror**, because `shared/` is browser-bundled and
  cannot import `@n-dx/rex`. `tests/unit/shared/item-type-contract.test.ts` pins
  them against rex's `LEVEL_HIERARCHY` / `CHILD_LEVEL`, so changing rex's level
  system fails a test here.
- The viewer reaches the helpers through `external.ts`, **accessors only** — the
  label, plural, emoji, parent and child tables stay behind the module so a
  consumer cannot index one and skip the v1 fallback.
