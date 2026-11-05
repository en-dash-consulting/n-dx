# Graview Projection

`@n-dx/graview` turns an n-dx project into one typed context graph on
[Graview](https://graview.dev): the product layer (areas, capabilities,
constraints), the change layer (changes, tasks, releases), the code
(zones, components, files) and the work (agent runs, commits).
Graview's declaration names every kind, field, relation, lens and rule once;
`graview check` holds it, `graview serve` serves it to a Graview face
(holding the key it prints, since 0.1.59),
`graview mcp` derives an agent tool surface from it. The face n-dx ships is
`@n-dx/graview-face`, a separately published package that `ndx graview serve`
runs when it is installed.

## The seam: two files, no imports

Graview's CLI accepts a `graview-document` declaration (JSON) and a seed
snapshot for every store command. The adapter therefore emits those two files
and spawns the `graview` binary on them. The snapshot is written in Graview's
line format (`@graview/core/snapshot`, format 2, by the adapter's own
`src/snapshot-file.ts` since it has no runtime Graview dependency): a header
line saying when it was made and how many records and links of each kind it
holds, then a record a line with each kind's together, then the links, so a
reader learns the projection's age from the first line and reads one kind by
byte range:

```
ndx graview emit .      →  <graviewDir>/document.json + snapshot.json
ndx graview check .     →  emit, then  graview check document.json
ndx graview describe .  →  emit, then  graview describe document.json --seed snapshot.json
ndx graview serve .     →  emit, then the product face's own server on the fresh projection
                           (or, with --no-face or no face installed: sync-seed the store, then
                           graview serve --data <graviewDir>/data, the store over HTTP plus its live
                           WebSocket wire that a Graview face connects to with the
                           ?graview_key= the command prints; a face on another origin
                           also needs --allow-origin <origin>)
ndx graview mcp .       →  emit, sync-seed the store, then  graview mcp --read-only
```

No n-dx package depends on `@graview/*`. The binary is a peer tool, the way
the `claude` and `codex` CLIs are to hench, resolved from `graview.bin` in the
project config, `NDX_GRAVIEW_BIN`, PATH, a product face checkout's own
`graview` (it pins the same release; the monorepo's face, or one under
`extensions.paths` — the published face installs none), then, only when the
user opts in with
`graview.allowNpx: true` in their own untracked local config or
`NDX_GRAVIEW_NPX=1`, `npx -y graview@<pinned>`
(`packages/graview/src/graview-bin.ts`). Without the opt-in nothing is
downloaded: `check`, `describe`, `mcp` and `serve` with no face to run stop
with a sentence on how to install graview, `emit` and a face's `serve` need
none, and `ndx graview info` says the source is `none`. A `.js` path runs
under the current Node, so a sibling framework checkout works without a global
install. npx runs in `<ndx home>/graview/npx`, an empty private package n-dx
owns, never the checkout, so a `graview` the repository installs in its
`node_modules` and the repository's `.npmrc` are not used.

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
changes (epics and features become changes; tasks and subtasks stay tasks).
Rather than project that empty product layer, the adapter draws the one rex's
v1-to-v2 migration plan proposes (`classifyV1Tree`, the plan's rules stage:
pure, deterministic, no model pass): an epic is an area unless its title names
a PR or a release, a feature with completed work a capability with a template
statement (`draftCapabilitySpecs`), a constraint-shaped feature a constraint,
the work under them changes placed on them by the placement rules, and what
the rules cannot place a change in the Inbox. A node whose v1 item completed is
stamped `metAt` with its spec hash, as applying the plan will, so rex's own
`computeProductStatus` reads it met rather than proposed (an open amending
change makes it changing). Every product node from the plan
carries `proposed: true`, the face says so on its home, and the sync refuses
writes to them; `graview.proposeProductLayer: false` projects the tree as
changes only. The migration (`Migrate this repository`) makes the map real,
and the same code path then reads the stored v2 tree.

| Graview kind | From | Id |
|---|---|---|
| `area`, `capability`, `constraint` | rex product layer, with `computeProductStatus` as `intentStatus` and `health` | rex id |
| `change` | rex change layer; `deriveChangeKind` as `changeKind`; `needsPlacement` as `inbox` | rex id |
| `task` | rex tasks and subtasks (`level`) | rex id |
| `release` | every `plannedRelease` and `shippedIn` value, and every release tag git has (`X.Y.Z`, `vX.Y.Z` or `<package>@X.Y.Z`, dated by the tag; `graview.mainRef` picks the branch) | `release:<version>` |
| `zone` | `zones.json`, sub-zones included | zone id |
| `component` | `components.json` | `component:<file>#<name>` |
| `file` (left out with `--no-files`) | `inventory.json` | `file:<path>` |
| `run` | `<henchDir>/runs/*.json[.gz]` | run id |
| `commit` | every commit on main whose `N-DX-Item` trailer names a change or task (`loadTrailerCommits`), and every commit a run record names (`RunRecord.commits`, filled live or by `hench backfill-commits`); git supplies author and date, and `attribution` says how the commit was tied | sha |

| Edge (declared on the kind it leaves) | From |
|---|---|
| `under` | parent/child in either layer; zone sub-zones |
| `dependsOn` | `capability.dependsOn` |
| `appliesTo` | `constraint.appliesTo` (an `"all"` binding is the `appliesToAll` field) |
| `amends`, `touches` | `change.amends[].target`, `change.touches` (rex derives `changedBy` and `coChanges` from these) |
| `blockedBy` | `blockedBy` on changes and tasks. Rex requires it to name a change-layer node, so a blocker that names a product node (on a v1 tree's proposed layer, the capability, constraint or area a blocking feature or epic became) is left out with a warning |
| `discoveredFrom` | `change.discoveredFrom.item` / `.run` |
| `plannedFor`, `shippedWith` | `change.plannedRelease`, `ItemState.shippedIn`; a finished change with no stamped `shippedIn` ships with the first release tag containing its landing (`computeLandings`, `releasesContaining`: rex's `resolveShippedIn` answer, for every change in one walk) |
| `landedFor` (commit → change or task; a capability, constraint or area when the trailer names a v1 feature or epic the migration turned into one, whether the plan only proposes it or has applied it) | the commit's `N-DX-Item` trailers, and the run record that names the commit (its task) |
| `realizedIn` (capability → zone), `realizes` (commit → capability) | every commit that landed for a change placed on the capability (`amends` or `touches`, via `changedBy`) or for the work under it, through `loadCommitFiles` and the zone map |
| `changed` (commit → file), `livesIn` (capability → file) | the same `loadCommitFiles` read, kept as edges when files are projected: every commit on the graph to the files it changed, and a capability to the files its realizing commits changed. A path the inventory no longer has is dropped |
| `inZone` | a component's or file's deepest zone |
| `crosses` | `zones.json` crossings and sub-crossings |
| `ranFor`, `produced` | `RunRecord.taskId` (a capability, constraint or area when the run worked a v1 feature or epic the migration turned into one, proposed or applied: run records keep the old id), `RunRecord.commits` |

A v1 tree gets all of this too: its changes carry `completedAt`, its tasks
the trailers, and the tags are git's; with the proposed product layer the
`realizes` and `realizedIn` edges follow, through the same commits. Rex's own
`computeRealizedBy` reads amending changes and trailers only; the projection
reads wider, because on a proposed layer the amends/touches relation is a
lead-verb guess and the hench-era commits reach the graph only through run
records. Run records are machine-local, so `hench backfill-commits .` on a
checkout is what gives its graph the history.

### Where the projection's names differ from rex's

An agent reads the same graph over `graview mcp` and over rex's MCP tools, so
every kind and relation the projection names differently from rex is listed
here. `tests/unit/document.test.ts` fails when the declaration gains a kind
or a relation rex does not have and the table's first column does not name
it. Fields are not covered by the test; the ones whose names differ are
`inbox` (rex's `needsPlacement`), `appliesToAll` (`appliesTo: "all"`),
`changeKind` (`deriveChangeKind`), `intentStatus` (`computeProductStatus`),
`reviewed` (a capability with a `reviewedHash`) and `level` on a change (`change`, or the
v1 level it was read from).

| Projection | Rex | Why |
|---|---|---|
| `task` with `level: "subtask"` | `subtask` node type | One kind of work reads better in Graview's places; a subtask is a smaller task |
| `under` | a node's parent: the folder nesting, `get_item`'s `parentChain`, and an added amendment's `under` | One relation for every containment, in both layers and between zones |
| `release` | `plannedRelease` and `shippedIn` fields on a change | A release is a place work gathers; Graview draws it as a record |
| `plannedFor`, `shippedWith` | the same two fields | The fields as relations to the `release` records |
| `zone`, `component`, `file` | none (sourcevision's output) | Where the work lives in code |
| `run`, `commit` | none (hench run records, git) | The work that made it |
| `inZone`, `crosses` | none (sourcevision) | A component's or file's zone; imports between zones |
| `ranFor`, `produced` | `RunRecord.taskId`, `RunRecord.commits` | A run's task and its commits |
| `landedFor` | the `N-DX-Item` trailer, and a run record's `commits` (the run's task) | A commit's work |
| `realizes`, `realizedIn`, `livesIn` | `computeRealizedBy`'s `commits`, `zones` and `files` (wider here: touches and run commits count) | Where a capability lives in code |
| `changed` | none (git's file lists) | A commit's files |
| `ranFor`, `landedFor` reaching a capability, constraint or area | a v1 feature or epic id | A run record or trailer named an item the migration turned into a product node, whether the plan only proposes it or has applied it; rex keeps no such edge. A `blockedBy` naming one is left out, as rex requires a change or task |

`packages/graview/src/document.ts` holds the two mapping tables
(`NODE_KINDS`, `PRODUCT_EDGE_SOURCES`) and `tests/unit/document.test.ts` fails
when a rex `NodeType` or `ProductEdges` key has no kind or edge in the
declaration. Rex's own rules stay the schema of record; the document's rules
mirror a computed state the snapshot already carries.

`ndx graview emit` holds the snapshot to the declaration (`src/fit.ts`):
every record's kind and fields, every enum value, list, number range and
step, required field, Graview's length caps (a string 500 characters, a
text 20,000, a list 200 items) and a `null` where Graview takes only an
absent field, and every edge's relation, target kind and cardinality.
`emit` warns about a misfit and `check` fails on one, naming the record,
because `graview check` judges the declaration alone and a misfit would
otherwise surface only as a `validateGraph` finding when a face loads the
pair. The adapter's tests run a set of bad snapshots through both `fit.ts`
and `@graview/core`'s `validateGraph` and fail when Graview flags one that
`fit.ts` passes; a field type `fit.ts` does not know (a url, an email) is
left to Graview. Rex, git and sourcevision set no length limits, so the
snapshot builder cuts any string, text or list to Graview's caps and warns,
rather than let a long description or commit subject fail `check`.

Ids are n-dx's own, so a Graview answer can be taken straight back to the tool
that owns the node. Edges whose far end is missing are dropped, never
invented. Nodes and edges are sorted and written as canonical JSON, so two
projections of an unchanged checkout are byte-identical.

## Places the declaration opens with

| Lens | Over |
|---|---|
| `columns` "Changes by status" | changes in columns by `status` |
| `calendar` "When runs ran" | runs spanning `startedAt` to `finishedAt`, a week at a time |
| `coverage` "Where capabilities live in code" | capabilities × zones through `realizedIn` |
| `calendar` "When changes closed" | changes by `completedAt` |
| `blocks` "Needs attention" | the Inbox, blocked changes, defective capabilities |

Graview's `board` and `plan` lenses are spatial (slots and regions) and do not
fit this graph; the status board is the `columns` lens. Nor does a
`timeline`: it lays spans out in numbers (minutes of a day), and since
Graview 0.1.63 one over dates is `lens-cannot-draw`, so runs, which span
dates, are a calendar.

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
- **In `@n-dx/graview-face`:** a Vite dev-server door (`dev/ndx-door.ts`) is
  Graview's `mcpDoor` over an `mcpClient` to the hub (one session, the token
  read per call and never sent to the page, only the four tools the sync
  names), re-emits on `POST /ndx/emit`, and serves the fresh projection from
  the graview dir by byte range. The remote (`src/sync/ndx-system.ts`) is an
  `mcpRemote` whose pull re-emits and reads only the changes and the tasks
  out of the snapshot (versioned by `lastModified`), and whose push writes a
  status through `update_task_status`, the rest through `edit_item`, after
  reading the item so only what differs is written, then `append_log` with
  `author=graview:<principal>`. The engine (`src/sync/engine.ts`) is
  `SyncEngine` from `@graview/core/sync` with `conflicts: "theirs"`: the
  mapping's `version` field links every projected record at the version it
  was made with, so the first run sends nothing; a field edited on both sides
  takes rex's value through the inbound act, and the report says so in the
  rail. It runs on an interval and a moment after any human or agent op.
- **Rex stays the single writer.** Every push is a rex MCP write under the
  file lock, validation and the execution log; the face never touches the
  tree. Every kind but change and task is a `readonly` resource whose
  `because` names the tool that owns the data (area, capability and
  constraint: rex's product layer; zone and component: sourcevision; run:
  hench; commit: git), and the engine guards the store, so an act on one is
  refused with that sentence and never offered. A static build has no door
  and is read-only by construction.

## The product face

- **A product face** exists: `@n-dx/graview-face` (`packages/graview-face`),
  a workspace package published on its own that no other `@n-dx/*` package
  depends on, so installing n-dx never pulls Graview or React. It is built
  from the emitted document with `appFromOrCompile`, with a shell, home and
  record pages in n-dx's words over the derived ones. It is the
  `graview-face` extension ([extensions.md](extensions.md)): `ndx graview
  serve .` asks core for its sidecar's launch plan, so finding and approving
  it are core's, and runs `bin/serve.js` on the fresh projection
  (`NDX_GRAVIEW_DIR`). The declaration carries
  glance, page groups, brand, the home and per-kind card, row and page
  blocks as data, so the face adds React and nothing about the graph.
## Deferred

- **Dashboard embed and graview.cloud publishing.**
