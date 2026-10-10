# Graview Projection

`@n-dx/graview` turns an n-dx project into one typed context graph on
[Graview](https://graview.dev): the product layer (areas, capabilities,
constraints), the change layer (changes, tasks, releases), the code
(zones, components, optionally files) and the work (agent runs, commits).
Graview's declaration names every kind, field, relation, lens and rule once;
`graview check` holds it, `graview serve` serves it to any Graview face,
`graview mcp` derives an agent tool surface from it.

## The seam: two files, no imports

Graview's CLI accepts a `graview-document` declaration (JSON) and a
`{nodes, edges}` seed snapshot for every store command. The adapter therefore
emits those two files and spawns the `graview` binary on them:

```
ndx graview emit .      →  <graviewDir>/document.json + snapshot.json
ndx graview check .     →  emit, then  graview check document.json
ndx graview describe .  →  emit, then  graview describe document.json --seed snapshot.json
ndx graview serve .     →  emit, sync-seed the store, then  graview serve --data <graviewDir>/data
                           (the store over HTTP plus its live WebSocket wire; a face connects to it)
ndx graview mcp .       →  emit, sync-seed the store, then  graview mcp --read-only
```

No n-dx package depends on `@graview/*`. The binary is a peer tool, the way
the `claude` and `codex` CLIs are to hench, resolved from `graview.bin` in the
project config, `NDX_GRAVIEW_BIN`, PATH, then `npx -y graview@0.1.19`
(`packages/graview/src/graview-bin.ts`). A `.js` path runs under the current
Node, so a sibling framework checkout works without a global install.

`graviewDir` is a field of the layout resolver (`.ndx/graview` or
`.graview`), gitignored by `ndx init`. Nothing is written under the rex,
sourcevision or hench directories: even the N-DX-Item trailer cache that
`computeRealizedBy` keeps goes under the graview dir.

## Where the package sits

Coordination level, beside web. It imports `@n-dx/rex` (the v2 PRD model
and its derived computations) and `@n-dx/sourcevision` (`DATA_FILES` and
schema types) at runtime, `@n-dx/hench` for the `RunRecord` type, and
`@n-dx/llm-client` for the layout and `spawnTool`, each through its own
gateway file in `packages/graview/src/`. `packages/core/gateway-rules.json`
lists the four; `tests/e2e/domain-isolation.test.js` enforces them. Core
spawns the package's CLI (`ndx graview` in `cli.js`) and never imports it.

## The mapping

The adapter consumes rex's `PrdModel` only. The v2 reader reads a v1 tree as
changes (epics and features become changes; tasks and subtasks stay tasks),
so an un-migrated checkout projects its changes, tasks, blockers and releases
with an empty product layer, through the same code path a v2 repository uses.

| Graview kind | From | Id |
|---|---|---|
| `area`, `capability`, `constraint` | rex product layer, with `computeProductStatus` as `intentStatus` and `health` | rex id |
| `change` | rex change layer; `deriveChangeKind` as `changeKind`; `needsPlacement` as `inbox` | rex id |
| `task` | rex tasks and subtasks (`level`) | rex id |
| `release` | every `plannedRelease` and `shippedIn` value | `release:<version>` |
| `zone` | `zones.json`, sub-zones included | zone id |
| `component` | `components.json` | `component:<file>#<name>` |
| `file` (with `--files`) | `inventory.json` | `file:<path>` |
| `run` | `<henchDir>/runs/*.json[.gz]` | run id |
| `commit` | a run's `commits`, and `computeRealizedBy`'s trailer commits | sha |

| Edge (declared on the kind it leaves) | From |
|---|---|
| `under` | parent/child in either layer; zone sub-zones |
| `dependsOn` | `capability.dependsOn` |
| `appliesTo` | `constraint.appliesTo` (an `"all"` binding is the `appliesToAll` field) |
| `amends`, `touches` | `change.amends[].target`, `change.touches` (rex derives `changedBy` and `coChanges` from these) |
| `blockedBy` | `blockedBy` on changes and tasks |
| `discoveredFrom` | `change.discoveredFrom.item` / `.run` |
| `plannedFor`, `shippedWith` | `change.plannedRelease`, `ItemState.shippedIn` |
| `realizedIn` (capability → zone), `realizes` (commit → capability) | `computeRealizedBy` through N-DX-Item trailers and the zone map |
| `inZone` | a component's or file's deepest zone |
| `crosses` | `zones.json` crossings and sub-crossings |
| `ranFor`, `produced` | `RunRecord.taskId`, `RunRecord.commits` |

`packages/graview/src/document.ts` holds the two mapping tables
(`NODE_KINDS`, `PRODUCT_EDGE_SOURCES`) and `tests/unit/document.test.ts` fails
when a rex `NodeType` or `ProductEdges` key has no kind or edge in the
declaration. Rex's own rules stay the schema of record; the document's rules
mirror a computed state the snapshot already carries.

Ids are n-dx's own, so a Graview answer can be taken straight back to the tool
that owns the node. Edges whose far end is missing are dropped, never
invented. Nodes and edges are sorted and written as canonical JSON, so two
projections of an unchanged checkout are byte-identical.

## Places the declaration opens with

| Lens | Over |
|---|---|
| `columns` "Changes by status" | changes in columns by `status` |
| `timeline` "Runs" | runs by `startedAt`/`finishedAt` |
| `coverage` "Where capabilities live in code" | capabilities × zones through `realizedIn` |
| `calendar` "When changes closed" | changes by `completedAt` |
| `blocks` "Needs attention" | the Inbox, blocked changes, defective capabilities |

Graview's `board` and `plan` lenses are spatial (slots and regions) and do not
fit this graph; the status board is the `columns` lens.

## Deferred

- **Two-way writes.** Graview's `SyncEngine` with a `RemoteSystem` whose push
  goes through rex's HTTP MCP endpoint, so rex stays the single PRD writer.
  The RemoteSystem implements a Graview interface and so belongs in the
  Graview-side product, not here.
- **A product face.** The declaration carries glance, page groups, brand,
  home and per-kind blocks as data; a custom pages face is React and lives in
  a sibling product repository built from the emitted document.
- **Dashboard embed and graview.cloud publishing.**
