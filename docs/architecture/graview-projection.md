# Graview Projection

`@n-dx/graview` turns an n-dx project into one typed context graph on
[Graview](https://graview.dev): the product layer (areas, capabilities,
constraints), the change layer (changes, tasks, releases), the code
(zones, components, optionally files) and the work (agent runs, commits).
Graview's declaration names every kind, field, relation, lens and rule once;
`graview check` holds it, `graview serve` serves it to any Graview face,
`graview mcp` derives an agent tool surface from it. The face n-dx ships is
`@n-dx/graview-face`, a separately published package that `ndx graview serve`
runs when it is installed.

## The seam: two files, no imports

Graview's CLI accepts a `graview-document` declaration (JSON) and a
`{nodes, edges}` seed snapshot for every store command. The adapter therefore
emits those two files and spawns the `graview` binary on them:

```
ndx graview emit .      →  <graviewDir>/document.json + snapshot.json
ndx graview check .     →  emit, then  graview check document.json
ndx graview describe .  →  emit, then  graview describe document.json --seed snapshot.json
ndx graview serve .     →  emit, then the product face's own server on the fresh projection
                           (or, with --no-face or no face installed: sync-seed the store, then
                           graview serve --data <graviewDir>/data, the store over HTTP plus its live
                           WebSocket wire that a Graview face connects to)
ndx graview mcp .       →  emit, sync-seed the store, then  graview mcp --read-only
```

No n-dx package depends on `@graview/*`. The binary is a peer tool, the way
the `claude` and `codex` CLIs are to hench, resolved from `graview.bin` in the
project config, `NDX_GRAVIEW_BIN`, PATH, the product face's own `graview`
(it pins the same release), then `npx -y graview@0.1.20`
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

## Two-way writes: where the RemoteSystem runs, and why

Decided before implementation, as the task asked: **the sync loop runs in
the product face, not in the adapter.** Graview's `SyncEngine` and
`RemoteSystem` are Graview interfaces; a worker in `@n-dx/graview` would
import `@graview/core`, and the whole point of the adapter is that no package
`@n-dx/core` depends on does. The face is its own package that nothing else
depends on. So:

- **In n-dx:** changes and tasks carry rex's `lastModified` (and
  `lastModifiedBy`) in the projection: the version a two-way sync agrees on,
  and what makes an echo of the face's own write recognizable. `ndx graview
  info` names the hub's per-project rex MCP endpoint (`<ndx home>/hub.json`;
  the port from `config.json`'s `hub.port`, else `hub.pid`, else 3117;
  `auth.token`), and `ndx graview serve` hands the product face
  `NDX_REX_MCP_URL`, `NDX_TOKEN_FILE`, `NDX_PROJECT_ROOT` and
  `NDX_GRAVIEW_CLI` beside `NDX_GRAVIEW_DIR`. A worktree is a separate
  workspace to the project's server, so for one the endpoint also carries
  `NDX_WORKTREE` and `NDX_WORKSPACES_URL`: the face resolves its workspace
  key from that listing and sends it as `X-Ndx-Workspace` on every write,
  or refuses to sync rather than write the main checkout's PRD. Nothing in
  n-dx opens a connection.
- **In `@n-dx/graview-face`:** a Vite dev-server door (`dev/ndx-door.ts`) holds the
  token and one MCP session to the hub, re-emits on `POST /ndx/emit`, and
  serves the fresh projection from the graview dir. The `RemoteSystem`
  (`src/sync/ndx-system.ts`) pulls by re-emitting and reading the snapshot
  (every change and task, versioned by `lastModified`), and pushes a status
  through `update_task_status`, the rest through `edit_item`, after reading
  the item so only what differs is written, then `append_log` with
  `author=graview:<principal>`. The engine (`src/sync/engine.ts`) seeds its
  links from the snapshot the store opened with, runs on an interval and a
  moment after any human or agent op, and resolves every conflict to rex's
  value, saying so in the rail.
- **Rex stays the single writer.** Every push is a rex MCP write under the
  file lock, validation and the execution log; the face never touches the
  tree. Code-side kinds (area, capability, constraint, release, zone,
  component, file, run, commit) have no push mapping, and a write is refused
  naming the tool that owns the data. A static build has no door and is
  read-only by construction.

## The product face

- **A product face** exists: `@n-dx/graview-face` (`packages/graview-face`),
  a workspace package published on its own that no other `@n-dx/*` package
  depends on, so installing n-dx never pulls Graview or React. It is built
  from the emitted document with `appFromOrCompile`, with a shell, home and
  record pages in n-dx's words over the derived ones. `ndx graview serve .`
  finds it beside `@n-dx/graview` in the monorepo or in `node_modules`, or
  through `graview.app` in the project config, and runs its `bin/serve.js`
  on the fresh projection (`NDX_GRAVIEW_DIR`). The declaration carries
  glance, page groups, brand, the home and per-kind card, row and page
  blocks as data, so the face adds React and nothing about the graph.
## Deferred

- **Dashboard embed and graview.cloud publishing.**
