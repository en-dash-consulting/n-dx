## @n-dx/graview-face: the product face, in the monorepo but outside the tiers

This package is a Graview product: a Vite + React app that compiles the
document `@n-dx/graview` emits (`appFromOrCompile`), seeds a store from the
snapshot, and lays a shell, home and record pages in n-dx's words over the
derived ones. It is published on its own and **no other `@n-dx/*` package
depends on it**: `@n-dx/core` never lists it, so installing n-dx never pulls
`@graview/*` or React. `ndx graview serve .` finds it beside `@n-dx/graview`
in the monorepo, or in `node_modules` when installed, or through
`graview.app` in the project config, and runs `bin/serve.js`.

Rules that keep that honest:

- **It imports no `@n-dx/*` package.** Everything it knows about the graph
  arrives as data in `/data/document.json` and `/data/snapshot.json`
  (`scripts/sync-data.mjs` copies them from the project's graview dir;
  `dev/ndx-door.ts` serves them live, by byte range when asked, since the
  snapshot is in Graview's line format and `fetchSnapshot` reads a kind at a
  time; and `/data/iso-map.html`, sourcevision's isometric map, which the
  Code map page and zone pages frame). That is why there are no gateways
  here and the domain-isolation tests have nothing to check.
- **The types come from the document.** `src/model/types.ts` is written by
  `graview types` from n-dx.graview.json (`pnpm types`), and `src/model/graph.ts`
  reads the store through `typedReader`, so a kind, field or relation renamed
  in the declaration fails `tsc` here. Regenerate it when the declaration
  changes; never edit it.
- **The declaration stays in `@n-dx/graview`.** Glance, page groups,
  computed fields and facts, field roles, brand, the home and per-kind blocks
  are data in `n-dx.graview.json`; this package adds React and read models
  (`src/model/`) only. A sentence that could be a block belongs there. A
  screen that draws part of a declared page itself claims the rest by the
  `key` the document gives each titled block (`DeclaredBlocks only`), never
  by its words.
- **Rex is the system of record.** `src/sync/` is Graview's `SyncEngine`
  (`@graview/core/sync`) with `conflicts: "theirs"`, over an `mcpRemote`
  that reaches rex's MCP tools through the dev door (`mcpDoor` over
  `mcpClient` in `dev/ndx-door.ts`, which holds the token; the browser never
  sees it). Every kind but change and task is a read-only resource whose
  `because` names the tool that owns it, and the engine guards the store, so
  such an act is refused and never offered. A write rex refuses (a
  transition its table forbids, a completion it holds for a run's test gate)
  is put back to rex's value after the run, and `status: deleted` is never
  sent. The door admits only requests carrying the key it writes into the
  page (`<meta name="ndx-door">`), and re-emits only when the PRD, runs,
  analysis or git refs changed. A static build has no door and is read-only
  by construction.
- **Framework workarounds go in `UPSTREAM.md`** with the graview PRD item
  each was captured as, and come out when the item closes.

Tests are headless (`tests/`): `compileDocumentFiles` compiles the
declaration from where it lives (`../graview/n-dx.graview.json`, so there is
no copy to drift), every titled place draws with `describePlace` over
`tests/fixtures/snapshot.json` (`pnpm fixture` refreshes it), and the sync
loop runs against a fake door. `pnpm doctor` says whether every Graview pin
and the React pair agree. `pnpm a11y` runs axe-core over the built site in
both schemes at phone and desktop width; `pnpm shots` photographs every
place with `graview shots`, and `pnpm look` opens the default faces on the
emitted files with `graview preview`. The last three need Playwright's
Chromium or a browser.
