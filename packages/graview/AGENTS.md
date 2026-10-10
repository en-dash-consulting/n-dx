## @n-dx/graview: a read-only projection, zero Graview imports

This package turns an n-dx project into the two files Graview's CLI reads: a
`graview-document` declaration (`n-dx.graview.json`, checked in here) and a
`{nodes, edges}` seed snapshot built from the rex PRD model, sourcevision's
JSON output and hench's run records. `ndx graview <sub>` then spawns the
`graview` binary on those files. Three rules keep that honest:

- **No `@graview/*` or `graview` dependency, ever.** The binary is a peer tool
  resolved from `graview.bin` in the project config, `NDX_GRAVIEW_BIN`, PATH,
  then `npx -y graview@<pinned>` (`src/graview-bin.ts`). A test fails the
  workspace if a `package.json` lists one.
- **Read-only.** Nothing is written under the rex, sourcevision or hench
  directories. Output and the trailer cache `computeRealizedBy` keeps go under
  the layout's graview dir (`.ndx/graview` or `.graview`), which `ndx init`
  gitignores.
- **One gateway per upstream package.** `src/rex-gateway.ts`,
  `src/sourcevision-gateway.ts`, `src/hench-gateway.ts` and
  `src/llm-gateway.ts` are the only files that import another `@n-dx/*`
  package; `packages/core/gateway-rules.json` lists them and
  `tests/e2e/domain-isolation.test.js` enforces it.

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
  cache/          the N-DX-Item trailer cache computeRealizedBy keeps
```

File nodes are opt-in (`--files`): zones, components and entry points keep a
repository this size inside Graview's comfortable scale.
