## @n-dx/graview: a read-only projection, zero Graview imports

This package turns an n-dx project into the two files Graview's CLI reads: a
`graview-document` declaration (`n-dx.graview.json`, checked in here) and a
`{nodes, edges}` seed snapshot built from the rex PRD model, sourcevision's
JSON output and hench's run records. `ndx graview <sub>` then spawns the
`graview` binary on those files. Three rules keep that honest:

- **No `@graview/*` or `graview` dependency, ever.** The binary is a peer tool
  resolved from `graview.bin` in the project config, `NDX_GRAVIEW_BIN`, PATH,
  then `npx -y graview@<pinned>` (`src/graview-bin.ts`). `@graview/core` is a
  devDependency only, so the tests can compile the declaration;
  `tests/e2e/architecture-policy.test.js` ("Graview stays a peer tool") fails
  the workspace if any `package.json` but the product face's lists one at
  runtime.
- **Read-only.** Nothing is written under the rex, sourcevision or hench
  directories. Output and the trailer and commit-file caches go under
  the layout's graview dir (`.ndx/graview` or `.graview`), which `ndx init`
  gitignores.
- **One gateway per upstream package.** `src/rex-gateway.ts`,
  `src/sourcevision-gateway.ts`, `src/hench-gateway.ts` and
  `src/llm-gateway.ts` are the only files that import another `@n-dx/*`
  package; `packages/core/gateway-rules.json` lists them and
  `tests/e2e/domain-isolation.test.js` enforces it.

### A v1 tree projects the product layer its migration plan proposes

`src/sources/proposed.ts` runs the rules stage of rex's v1-to-v2 migration
plan (`classifyV1Tree`, `draftCapabilitySpecs`: pure, no model pass) over a v1
tree and projects the areas, capabilities and constraints it proposes, each
`proposed: true`, with the tree's changes placed on them. A node the plan
marks `met` (its v1 item completed) is stamped `metAt` with its spec hash, as
the apply will, so `computeProductStatus` says met, changing or revised. It
writes nothing and invents no judgement rex has not made: the plan is rex's, and
`graview.proposeProductLayer: false` turns it off. When the PRD migrates, the
stored v2 tree takes over on the same code path.

### The declaration is the schema of record for the projection, not for rex

`n-dx.graview.json` names a kind for every rex v2 node type and an edge for
every stored and derived relation (`src/document.ts` holds the mapping tables;
`tests/unit/document.test.ts` fails when a rex `NodeType` or `ProductEdges`
key has no kind or edge). Rex's own rules (`schema/v2-rules.ts`) stay where
they are: the document's `rules` mirror a computed state the snapshot already
carries, never a judgement rex has not made.

### Layout of the output

```
<graviewDir>/
  document.json   the declaration, `name` set to the project
  snapshot.json   {nodes, edges}, canonically sorted — byte-identical on an unchanged checkout
  data/           graview's own store, created by `serve` and `mcp`; refreshed with `sync-seed`
  cache/          rex's N-DX-Item trailer cache and commit-file cache, kept here
```

File nodes are opt-in (`--files`): zones, components and entry points keep a
repository this size inside Graview's comfortable scale.

### The product face

`graview.app` in the project config names a checkout of a Graview product
built from the emitted document (`@n-dx/graview-face`, published on its own and depended on by nothing). With
it set, `ndx graview serve .` emits, then runs that product's dev server with
`NDX_GRAVIEW_DIR` pointing at the fresh files, instead of the bare
`graview serve` (which is the store's HTTP and WebSocket wire and draws
nothing). The declaration's `views` (home, per-kind card/row/page blocks),
`glance`, `page` groups, `computed` fields, `brand` and titled `lenses` are
what that face draws; keep the data there, and React only in the product.

### Two-way writes live in the product face

`SyncEngine` and `RemoteSystem` are Graview interfaces, so the loop runs in
`@n-dx/graview-face`, never here. What this package provides is the version
(`lastModified` on changes and tasks in the projection), the endpoint
(`rexMcpEndpoint` in `src/hub.ts`, from the hub registry under the ndx
home), and the hand-off (`ndx graview serve` sets `NDX_REX_MCP_URL`,
`NDX_TOKEN_FILE`, `NDX_PROJECT_ROOT`, `NDX_GRAVIEW_CLI`). Rex stays the
single writer: a face pushes through rex's MCP tools, never the tree.
